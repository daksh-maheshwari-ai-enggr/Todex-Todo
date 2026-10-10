import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  isAIMessage,
} from "@langchain/core/messages";
import { createChatModel } from "./openrouter.js";
import { config } from "./config.js";
import { tools } from "./tools/registry.js";
import { startToolExecution, finishToolExecution } from "./toolExecutions.js";

// Maximum length of a single inbound user message. Kept in sync with the
// Message.content column limit in prisma/schema.prisma.
export const MAX_MESSAGE_LENGTH = 4000;

// Safety cap on the number of tool executions in one turn. Once reached, the
// graph stops requesting tools and forces a plain final answer instead of
// looping forever. `recursionLimit` below is a second backstop.
const MAX_TOOL_CALLS = 8;
const GRAPH_RECURSION_LIMIT = 25;

// LangGraph state definition for the agent workflow.
const AgentState = Annotation.Root({
  // Trusted execution context, set by server-side code at invoke time. It is
  // never derived from model output or tool arguments.
  userId: Annotation({ reducer: (_, next) => next, default: () => null }),
  chatId: Annotation({ reducer: (_, next) => next, default: () => null }),
  botJob: Annotation({ reducer: (_, next) => next, default: () => "" }),
  botInstructions: Annotation({ reducer: (_, next) => next, default: () => "" }),
  conversationHistory: Annotation({
    reducer: (_, next) => next,
    default: () => [],
  }),
  message: Annotation({ reducer: (_, next) => next, default: () => "" }),
  // Working LangChain message list. Appended to by the model and tool nodes so
  // the tool loop can keep feeding results back to the model.
  messages: Annotation({
    reducer: (current, next) => current.concat(next),
    default: () => [],
  }),
});

// Build the model once and reuse it (and the compiled graph) across requests.
const chatModel = createChatModel();
const modelWithTools = chatModel.bindTools(tools);
const toolNode = new ToolNode(tools);

export function buildSystemPrompt(botJob, botInstructions) {
  return [
    botJob ? `Your job: ${botJob}` : "",
    botInstructions ? `Instructions:\n${botInstructions}` : "",
    "You are an assistant that responds to user messages in the context of the bot's job and instructions. Respond as concisely as possible.",
    "You may call the available tools to manage the user's tasks. Only call a tool when it is genuinely needed, and use the results to answer.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
      .join("");
  }
  return "";
}

// Convert persisted history ({ role, content } with USER/ASSISTANT/TOOL roles)
// into LangChain chat messages.
function historyToMessages(history) {
  const messages = [];
  for (const entry of history || []) {
    const role = String(entry?.role || "").toUpperCase();
    const content = contentToText(entry?.content);
    if (!content) continue;
    if (role === "USER") messages.push(new HumanMessage(content));
    else if (role === "ASSISTANT") messages.push(new AIMessage(content));
  }
  return messages;
}

// Seed the working message list from the bot prompt, the persisted history and
// the current user message (without adding the current message twice).
function buildInitialMessages(state) {
  const messages = [
    new SystemMessage(buildSystemPrompt(state.botJob, state.botInstructions)),
    ...historyToMessages(state.conversationHistory),
  ];

  const currentMessage = String(state.message || "").trim();
  const last = state.conversationHistory?.at?.(-1);
  const alreadyPersisted =
    last &&
    String(last.role || "").toUpperCase() === "USER" &&
    String(last.content || "").trim() === currentMessage;

  if (!alreadyPersisted) {
    messages.push(new HumanMessage(currentMessage));
  }

  return messages;
}

// Model node: on the first pass seeds the prompt/history, then calls the
// tool-bound model. On later passes it reuses the accumulated message list.
async function modelNode(state, runtimeConfig) {
  const isFirstPass = state.messages.length === 0;
  const base = isFirstPass ? buildInitialMessages(state) : state.messages;
  const aiMessage = await modelWithTools.invoke(base, runtimeConfig);

  // Persist the seed into state on the first pass so it survives the loop.
  return isFirstPass
    ? { messages: [...base, aiMessage] }
    : { messages: [aiMessage] };
}

// Final node used when the tool-call cap is reached: call the model without
// tools so it must produce a normal answer. Any pending tool calls are dropped
// from the last AI message so the provider does not reject an unanswered call.
async function finalizeNode(state, runtimeConfig) {
  const messages = state.messages.slice();
  const last = messages.at(-1);
  if (isAIMessage(last) && last.tool_calls?.length) {
    messages[messages.length - 1] = new AIMessage({
      content: contentToText(last.content) || "",
    });
  }

  const aiMessage = await chatModel.invoke(messages, runtimeConfig);
  return { messages: [aiMessage] };
}

// Conditional routing after the model: run tools while the model requests them,
// force a final answer once the cap is reached, otherwise finish the graph.
function routeAfterModel(state) {
  const last = state.messages.at(-1);
  const hasToolCalls =
    isAIMessage(last) && Array.isArray(last.tool_calls) && last.tool_calls.length > 0;

  if (!hasToolCalls) return END;

  const executedToolCalls = state.messages.filter(
    (message) => message.getType?.() === "tool",
  ).length;

  return executedToolCalls >= MAX_TOOL_CALLS ? "finalize" : "tools";
}

// Tools node: runs the requested tool calls via the LangGraph ToolNode and
// records each execution. It wraps ToolNode so tool results still reach the
// model in the expected format, while persistence is best-effort and never
// blocks tool execution or the reasoning loop. User/chat identity comes from
// trusted graph state, never from model-generated tool arguments.
async function toolsExecutionNode(state, runtimeConfig) {
  const last = state.messages.at(-1);
  const toolCalls =
    isAIMessage(last) && Array.isArray(last.tool_calls) ? last.tool_calls : [];

  const started = new Map();

  await Promise.all(
    toolCalls.map(async (call) => {
      const startedAt = new Date();
      let recordId = null;
      try {
        const record = await startToolExecution({
          chatId: state.chatId,
          userId: state.userId,
          toolName: call.name,
          toolCallId: call.id,
          args: call.args,
        });
        recordId = record?.id ?? null;
      } catch (error) {
        // A persistence failure must not block tool execution or the loop; the
        // execution simply is not recorded. Only the message is logged.
        console.warn("Failed to record tool execution start:", error?.message);
      }
      started.set(call.id, { recordId, startedAt });
    }),
  );

  const result = await toolNode.invoke(state, runtimeConfig);
  const toolMessages = Array.isArray(result?.messages) ? result.messages : [];

  await Promise.all(
    toolMessages.map(async (message) => {
      const info = started.get(message.tool_call_id);
      if (!info?.recordId) return;

      const failed = message.status === "error";
      try {
        await finishToolExecution({
          id: info.recordId,
          status: failed ? "FAILED" : "SUCCEEDED",
          result: failed ? null : contentToText(message.content),
          error: failed ? contentToText(message.content) : null,
          startedAt: info.startedAt,
          completedAt: new Date(),
        });
      } catch (error) {
        console.warn("Failed to record tool execution result:", error?.message);
      }
    }),
  );

  return result;
}

// START -> model -> (tools -> model | finalize | END). Compiled once at load.
const agentGraph = new StateGraph(AgentState)
  .addNode("model", modelNode)
  .addNode("tools", toolsExecutionNode)
  .addNode("finalize", finalizeNode)
  .addEdge(START, "model")
  .addConditionalEdges("model", routeAfterModel, ["tools", "finalize", END])
  .addEdge("tools", "model")
  .addEdge("finalize", END)
  .compile();

function extractFinalResponse(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (isAIMessage(messages[i])) {
      const text = contentToText(messages[i].content).trim();
      if (text) return text;
    }
  }
  return "";
}

// Execute the agent workflow. Kept separate from Express route handling so the
// transport layer only deals with HTTP concerns. `userId` is trusted context
// supplied by the authenticated request, not by the model.
export async function generateAgentResponse({
  userId,
  chatId,
  botJob,
  botInstructions,
  conversationHistory = [],
  message,
  timeoutMs = config.openRouter.timeoutMs,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await agentGraph.invoke(
      {
        userId,
        chatId,
        botJob,
        botInstructions,
        conversationHistory,
        message,
      },
      { signal: controller.signal, recursionLimit: GRAPH_RECURSION_LIMIT },
    );
    return extractFinalResponse(result.messages);
  } finally {
    clearTimeout(timer);
  }
}

export { agentGraph };
