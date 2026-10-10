import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";
import { createChatModel } from "./openrouter.js";
import { config } from "./config.js";

// Maximum length of a single inbound user message. Kept in sync with the
// Message.content column limit in prisma/schema.prisma.
export const MAX_MESSAGE_LENGTH = 4000;

// LangGraph state definition for the agent workflow. Every field must be
// declared explicitly so the graph knows how to merge node updates.
const AgentState = Annotation.Root({
  botJob: Annotation({ reducer: (_, next) => next, default: () => "" }),
  botInstructions: Annotation({ reducer: (_, next) => next, default: () => "" }),
  conversationHistory: Annotation({
    reducer: (_, next) => next,
    default: () => [],
  }),
  message: Annotation({ reducer: (_, next) => next, default: () => "" }),
  response: Annotation({ reducer: (_, next) => next, default: () => "" }),
});

// Build the model once and reuse it (and the compiled graph) across requests.
const chatModel = createChatModel();

export function buildSystemPrompt(botJob, botInstructions) {
  return [
    botJob ? `Your job: ${botJob}` : "",
    botInstructions ? `Instructions:\n${botInstructions}` : "",
    "You are an assistant that responds to user messages in the context of the bot's job and instructions. Respond as concisely as possible.",
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

// Model node: assembles the prompt from the bot job/instructions, the persisted
// conversation history and the current user message, then calls the provider.
async function callModel(state) {
  const messages = [
    new SystemMessage(buildSystemPrompt(state.botJob, state.botInstructions)),
    ...historyToMessages(state.conversationHistory),
  ];

  // The current user message is supplied separately from history. If the last
  // persisted message is already this same user message, do not add it twice.
  const currentMessage = String(state.message || "").trim();
  const last = state.conversationHistory?.at?.(-1);
  const alreadyPersisted =
    last &&
    String(last.role || "").toUpperCase() === "USER" &&
    String(last.content || "").trim() === currentMessage;

  if (!alreadyPersisted) {
    messages.push(new HumanMessage(currentMessage));
  }

  const aiMessage = await chatModel.invoke(messages);
  return { response: contentToText(aiMessage.content) };
}

// Single model node: START -> model -> END. Compiled once at module load.
const agentGraph = new StateGraph(AgentState)
  .addNode("model", callModel)
  .addEdge(START, "model")
  .addEdge("model", END)
  .compile();

// Execute the agent workflow. Kept separate from Express route handling so the
// transport layer only deals with HTTP concerns.
export async function generateAgentResponse({
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
        botJob,
        botInstructions,
        conversationHistory,
        message,
      },
      { signal: controller.signal },
    );
    return result.response;
  } finally {
    clearTimeout(timer);
  }
}

export { agentGraph };
