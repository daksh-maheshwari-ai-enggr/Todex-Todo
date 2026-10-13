import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
  ToolMessage,
  isAIMessage,
} from "@langchain/core/messages";
import { createChatModel } from "./openrouter.js";
import { config } from "./config.js";
import { tools } from "./tools/registry.js";
import { createHandoffTool } from "./tools/handoff.js";
import { startToolExecution, finishToolExecution } from "./toolExecutions.js";
import { createApproval, hasPendingApproval } from "./approvals.js";
import { createToolMessage } from "./messages.js";
import { incrementJobStepCount } from "./jobs.js";
import { createHandoff, finishHandoff } from "./handoffs.js";
import {
  activityAgentThinking,
  activityToolStarted,
  activityToolFinished,
  activityHandoff,
} from "./activity.js";

// Maximum length of a single inbound user message. Kept in sync with the
// Message.content column limit in prisma/schema.prisma.
export const MAX_MESSAGE_LENGTH = 4000;

// Per-turn tool-call cap when no explicit budget is supplied (see
// config.agent). The graph stops requesting tools once reached and forces a
// plain final answer; the invoke-time `recursionLimit` is a second backstop.
const DEFAULT_MAX_TOOL_CALLS = config.agent.maxToolCallsSync;

// Tool names that must never run without an explicit user approval. Read from
// config so operators can widen the set (e.g. APPROVAL_GATED_TOOLS=sandbox_execute_command).
function isGatedTool(toolName) {
  return config.approvals.gatedTools.includes(String(toolName || ""));
}

// Human-readable description of a deferred action, shown on the approval card.
function describeGatedAction(call) {
  let argsText = "";
  try {
    argsText = JSON.stringify(call.args ?? {});
  } catch {
    argsText = String(call.args ?? "");
  }
  if (argsText.length > 400) argsText = `${argsText.slice(0, 400)}…`;
  return `The teammate wants to run ${call.name} with: ${argsText}. Approve it?`;
}

// Resolve the tool-call budget for a run. Zero is a meaningful budget (a job
// whose lifetime step allowance is exhausted), so it must not fall back to the
// default the way a missing value does.
function resolveToolBudget(maxToolCalls) {
  if (maxToolCalls === null || maxToolCalls === undefined || maxToolCalls === "") {
    return DEFAULT_MAX_TOOL_CALLS;
  }
  const parsed = Number(maxToolCalls);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MAX_TOOL_CALLS;
  return Math.floor(parsed);
}

function safeParseArgs(raw) {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// LangGraph state definition for the agent workflow.
const AgentState = Annotation.Root({
  // Trusted execution context, set by server-side code at invoke time. It is
  // never derived from model output or tool arguments.
  userId: Annotation({ reducer: (_, next) => next, default: () => null }),
  chatId: Annotation({ reducer: (_, next) => next, default: () => null }),
  botId: Annotation({ reducer: (_, next) => next, default: () => null }),
  // Teammates that may participate in this chat (trusted, server-resolved).
  participants: Annotation({ reducer: (_, next) => next, default: () => [] }),
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
  // Human-in-the-loop pause state (trusted, server-set — never model output):
  // the background job this run belongs to (null for synchronous chat turns),
  // the approval being resumed (when the run was restarted by a user response),
  // the id of the approval that paused the run after a tool round, and the
  // gated tool-call ids an APPROVED ACTION resume is allowed to execute.
  aiJobId: Annotation({ reducer: (_, next) => next, default: () => null }),
  resumeApproval: Annotation({ reducer: (_, next) => next, default: () => null }),
  pendingApprovalId: Annotation({ reducer: (_, next) => next, default: () => null }),
  bypassToolCallIds: Annotation({ reducer: (_, next) => next, default: () => [] }),
  maxToolCalls: Annotation({
    reducer: (_, next) => next,
    default: () => DEFAULT_MAX_TOOL_CALLS,
  }),
  // Wall-clock ceiling for the whole run (epoch ms, trusted and server-set).
  // When it passes, the graph stops requesting tools and forces a truthful
  // summary instead of being killed mid-call by the abort timer.
  deadlineAt: Annotation({ reducer: (_, next) => next, default: () => null }),
});

// Build the model once and reuse it (and the compiled graph) across requests.
const chatModel = createChatModel();

// The handoff tool delegates to another teammate via the runner below. The
// runner is injected as a function reference (no circular import) and receives
// only trusted, server-resolved context.
const handoffTool = createHandoffTool({ runTeammate: runTeammateAgent });
const allTools = [...tools, handoffTool];
// One line at load so "which tools does the agent actually have?" is never a
// guess when debugging a missing tool call.
console.log(`[agent] registered ${allTools.length} tools: ${allTools.map((t) => t.name).join(", ")}`);
const modelWithTools = chatModel.bindTools(allTools);
const toolNode = new ToolNode(allTools);

export function buildSystemPrompt(botJob, botInstructions, participants = [], botId = null) {
  const teammates = (participants || []).filter((p) => p && p.id !== botId);
  const teammateList = teammates
    .map((t) => `- ${t.name} (id: ${t.id}) — ${t.job}`)
    .join("\n");

  return [
    botJob ? `Your job: ${botJob}` : "",
    botInstructions ? `Instructions:\n${botInstructions}` : "",
    "You are an assistant that responds to user messages in the context of the bot's job and instructions. Respond as concisely as possible.",
    "You may call the available tools to manage the user's tasks. Only call a tool when it is genuinely needed, and use the results to answer.",
    "When a step genuinely needs the human — signing in (password/OTP), paying or confirming a purchase, sending a message on the user's behalf, deleting data, or a choice you must not guess — call ask_user with a short, concrete question and offer options. Then continue with the answer you receive as the tool result. Never claim the user approved, sent or booked anything they did not.",
    teammateList
      ? `You can delegate work to these teammates by calling handoff_to_teammate with the teammate id and a clear task:\n${teammateList}`
      : "",
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

// Parse a tool execution's stored arguments back into an object. A tool call
// whose arguments cannot be parsed is still reconstructed (with empty args)
// rather than dropping the result, which the model may still need.
function parseToolArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Convert persisted history ({ role, content } with USER/ASSISTANT/TOOL roles)
// into LangChain chat messages.
//
// Tool results are stored as TOOL rows, but providers only accept a tool result
// that answers a preceding assistant tool_call. Those intermediate tool-call
// messages are not persisted (the model's reasoning turns are not chat
// content), so every consecutive run of TOOL entries is preceded here by a
// synthesized AIMessage carrying the calls resolved by memory.js. This is what
// lets a resumed or retried run see the work it already did instead of
// starting over.
function historyToMessages(history, excludeIds = null) {
  const messages = [];
  let toolRun = [];

  const flushToolRun = () => {
    if (toolRun.length === 0) return;

    messages.push(
      new AIMessage({
        content: "",
        tool_calls: toolRun.map((entry) => ({
          type: "tool_call",
          name: entry.name,
          args: entry.args,
          id: entry.id,
        })),
      }),
    );

    for (const entry of toolRun) {
      messages.push(new ToolMessage({ tool_call_id: entry.id, content: entry.content }));
    }

    toolRun = [];
  };

  for (const entry of history || []) {
    // On a resume the approval response is re-fed as the deferred tool result,
    // so its chat message is excluded to keep chronology and avoid duplication.
    if (excludeIds && entry?.id && excludeIds.has(entry.id)) continue;
    const role = String(entry?.role || "").toUpperCase();
    const content = contentToText(entry?.content);
    if (!content) continue;

    if (role === "TOOL") {
      // A tool result with no call id cannot be paired with an assistant call,
      // so it is unusable as provider input and is skipped.
      if (!entry.toolCallId) continue;
      toolRun.push({
        id: entry.toolCallId,
        name: entry.toolName || "tool",
        args: parseToolArgs(entry.toolArgs),
        content,
      });
      continue;
    }

    flushToolRun();
    if (role === "USER") messages.push(new HumanMessage(content));
    else if (role === "ASSISTANT") messages.push(new AIMessage(content));
  }

  flushToolRun();
  return messages;
}

// Seed the working message list from the bot prompt, the persisted history and
// the current user message (without adding the current message twice).
function buildInitialMessages(state) {
  const messages = [
    new SystemMessage(
      buildSystemPrompt(state.botJob, state.botInstructions, state.participants, state.botId),
    ),
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

  // Real milestone: the model is being asked to decide the next action.
  const step = state.messages.filter((message) => message.getType?.() === "ai").length + 1;
  activityAgentThinking({ chatId: state.chatId, botId: state.botId, step });

  const aiMessage = await modelWithTools.invoke(base, runtimeConfig);

  // Persist the seed into state on the first pass so it survives the loop.
  return isFirstPass
    ? { messages: [...base, aiMessage] }
    : { messages: [aiMessage] };
}

// Number of tool results already produced in this run. Used for the tool-call
// budget and for explaining why a run stopped.
function countToolMessages(messages) {
  return (messages || []).filter((message) => message.getType?.() === "tool").length;
}

function isPastDeadline(state) {
  return Boolean(state.deadlineAt) && Date.now() > state.deadlineAt;
}

// Final node used when the tool-call cap or the time budget is reached: call the
// model without tools so it must produce a normal answer. The model is told why
// it is being stopped so the answer is an honest summary of what it completed
// and what it did not, instead of an invented success. Any pending tool calls
// are dropped from the last AI message so the provider does not reject an
// unanswered call.
async function finalizeNode(state, runtimeConfig) {
  const messages = state.messages.slice();
  const last = messages.at(-1);
  if (isAIMessage(last) && last.tool_calls?.length) {
    messages[messages.length - 1] = new AIMessage({
      content: contentToText(last.content) || "",
    });
  }

  messages.push(new HumanMessage(describeStop(state)));

  const aiMessage = await chatModel.invoke(messages, runtimeConfig);
  return { messages: [aiMessage] };
}

// Why the run is being cut short, stated in the terms that actually ran out.
function describeStop(state) {
  const executed = countToolMessages(state.messages);
  const maxToolCalls = resolveToolBudget(state.maxToolCalls);

  const reasons = [];
  if (isPastDeadline(state)) reasons.push("its time budget ran out");
  if (executed >= maxToolCalls) {
    reasons.push(
      `the tool-call budget for this run (${maxToolCalls}) is exhausted`,
    );
  }

  if (reasons.length === 0) {
    return "Stop calling tools and answer now, in plain text, using what you already know.";
  }

  return [
    `Stop calling tools and answer now, in plain text. The run was stopped because ${reasons.join(
      " and ",
    )}.`,
    "Briefly state what you completed, what you did not finish, and what the user should do next.",
    "Do not claim to have done anything you did not actually do.",
  ].join(" ");
}

// Conditional routing after the model: run tools while the model requests them,
// force a final answer once a budget is exhausted, otherwise finish the graph.
function routeAfterModel(state) {
  // A run that just paused must end before any further model call.
  if (state.pendingApprovalId) return END;

  const last = state.messages.at(-1);
  const hasToolCalls =
    isAIMessage(last) && Array.isArray(last.tool_calls) && last.tool_calls.length > 0;

  if (!hasToolCalls) return END;

  if (isPastDeadline(state)) return "finalize";

  const executedToolCalls = countToolMessages(state.messages);

  const maxToolCalls = Number(state.maxToolCalls) || DEFAULT_MAX_TOOL_CALLS;
  return executedToolCalls >= maxToolCalls ? "finalize" : "tools";
}

// After a tool round: stop the graph when a human approval is pending (either
// raised by ask_user this round or by the sensitive-action gate), force a
// summary when the time budget is gone, otherwise continue reasoning with the
// tool results.
function routeAfterTools(state) {
  if (state.pendingApprovalId) return END;
  return isPastDeadline(state) ? "finalize" : "model";
}

// Entry routing. A resume of an APPROVED ACTION starts at the tools node so the
// deferred call is executed for real (its result must never be faked); every
// other entry starts at the model.
function routeStart(state) {
  const approval = state.resumeApproval;
  if (approval && approval.kind === "ACTION" && approval.status === "APPROVED") {
    return "tools";
  }
  return "model";
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

  if (toolCalls.length === 0) {
    return {};
  }

  // Split the round: gated calls are deferred behind an explicit user approval
  // (or executed directly when a resume carries their approval id), everything
  // else runs now.
  const bypass = new Set(state.bypassToolCallIds || []);
  const gated = toolCalls.filter((call) => isGatedTool(call.name) && !bypass.has(call.id));
  const runnable = toolCalls.filter((call) => !gated.includes(call));

  if (gated.length > 0) {
    const deferred = gated[0];
    // Only the first gated call of the round becomes the approval; any others
    // are dropped unexecuted (their result is never faked) and are re-decided
    // by the model after the user responds.
    let argsJson = null;
    try {
      argsJson = JSON.stringify(deferred.args ?? {});
    } catch {
      argsJson = null;
    }

    await createApproval({
      userId: state.userId,
      chatId: state.chatId,
      botId: state.botId,
      aiJobId: state.aiJobId,
      kind: "ACTION",
      question: describeGatedAction(deferred),
      toolName: deferred.name,
      toolCallId: deferred.id,
      args: argsJson,
    });
  }

  console.log(
    `[agent] executing ${runnable.length} of ${toolCalls.length} tool call(s) for chat ${state.chatId}: ${
      runnable.map((c) => c.name).join(", ") || "(none)"
    }${gated.length ? ` (deferred for approval: ${gated.map((c) => c.name).join(", ")})` : ""}`,
  );

  const started = new Map();

  await Promise.all(
    runnable.map(async (call) => {
      const startedAt = new Date();
      let recordId = null;
      try {
        const record = await startToolExecution({
          chatId: state.chatId,
          userId: state.userId,
          toolName: call.name,
          toolCallId: call.id,
          args: call.args,
          // Attribute the execution to its job so the job's own step timeline
          // can be read back (jobs.listJobSteps).
          aiJobId: state.aiJobId,
        });
        recordId = record?.id ?? null;
      } catch (error) {
        // A persistence failure must not block tool execution or the loop; the
        // execution simply is not recorded. Only the message is logged.
        console.warn("Failed to record tool execution start:", error?.message);
      }

      activityToolStarted({
        chatId: state.chatId,
        botId: state.botId,
        toolName: call.name,
        args: call.args,
      });

      started.set(call.id, { recordId, startedAt });
    }),
  );
  // When calls were deferred, ToolNode must only see the runnable subset: a
  // filtered copy of the last AI message is appended purely for execution. It
  // never reaches the model because the pending approval ends the run below.
  const toolNodeState =
    gated.length > 0
      ? {
          ...state,
          messages: [
            ...state.messages,
            new AIMessage({ content: last.content, tool_calls: runnable }),
          ],
        }
      : state;

  const result =
    runnable.length > 0 ? await toolNode.invoke(toolNodeState, runtimeConfig) : { messages: [] };
  const toolMessages = Array.isArray(result?.messages) ? result.messages : [];

  await Promise.all(
    toolMessages.map(async (message) => {
      const info = started.get(message.tool_call_id);
      // No execution record means the tool result cannot be reconstructed as
      // context later (memory.js pairs a TOOL message with its ToolExecution),
      // so nothing durable is written for it.
      if (!info?.recordId) return;

      const failed = message.status === "error";
      const text = contentToText(message.content) || "(no output)";

      // Publish the tool's actual outcome (bounded) to the live activity stream.
      activityToolFinished({
        chatId: state.chatId,
        botId: state.botId,
        toolName: message.name ?? "tool",
        result: text,
        ok: !failed,
      });

      try {
        await finishToolExecution({
          id: info.recordId,
          status: failed ? "FAILED" : "SUCCEEDED",
          result: failed ? null : text,
          error: failed ? text : null,
          startedAt: info.startedAt,
          completedAt: new Date(),
        });
      } catch (error) {
        console.warn("Failed to record tool execution result:", error?.message);
      }

      // Persist the result as durable context so a later attempt (a retry, a
      // crash resume, or a resume after the user answers a question) continues
      // from this work instead of repeating it. Keyed by tool-call id, so a
      // re-executed round updates the row rather than duplicating it.
      try {
        await createToolMessage(
          state.chatId,
          state.userId,
          {
            content: text.slice(0, MAX_MESSAGE_LENGTH),
            toolCallId: message.tool_call_id,
            botId: state.botId,
          },
        );
      } catch (error) {
        console.warn("Failed to persist tool result as context:", error?.message);
      }
    }),
  );

  // Count this round against the job's lifetime step budget. One write per
  // round and best-effort: bookkeeping must never break the run.
  if (state.aiJobId && runnable.length > 0) {
    try {
      await incrementJobStepCount({ jobId: state.aiJobId, by: 1 });
    } catch (error) {
      console.warn("Failed to record the job's step count:", error?.message);
    }
  }

  // Whether the pause was raised by ask_user or by the sensitive-action gate,
  // the run stops here; the user's response re-enters the graph through the
  // resume path with this approval id as the marker.
  const pending = await hasPendingApproval(state.chatId);

  return { ...result, pendingApprovalId: pending ? pending.id : null };
}

// START -> (model | resumed ACTION -> tools) -> (tools -> model | END).
// Compiled once at load.
const agentGraph = new StateGraph(AgentState)
  .addNode("model", modelNode)
  .addNode("tools", toolsExecutionNode)
  .addNode("finalize", finalizeNode)
  .addConditionalEdges(START, routeStart, ["model", "tools"])
  .addConditionalEdges("model", routeAfterModel, ["tools", "finalize", END])
  .addConditionalEdges("tools", routeAfterTools, ["model", "finalize", END])
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

// Rebuild the working message list for a resumed run: system prompt + stored
// history (minus the user's approval response, which is re-fed as the deferred
// tool result) + the synthetic assistant tool call being resumed + its result.
// An APPROVED ACTION deliberately gets no ToolMessage here — the graph starts
// at the tools node so the stored call executes for real.
function buildResumeMessages(state) {
  const approval = state.resumeApproval;
  const isAction = approval.kind === "ACTION";
  const excludeIds = new Set([approval.responseMessageId].filter(Boolean));

  const messages = [
    new SystemMessage(
      buildSystemPrompt(state.botJob, state.botInstructions, state.participants, state.botId),
    ),
    ...historyToMessages(state.conversationHistory, excludeIds),
  ];

  const toolCallId = approval.toolCallId || `resume-${approval.id}`;
  const args = isAction
    ? safeParseArgs(approval.args)
    : {
        question: approval.question,
        options: String(approval.options || "").split("\n").filter(Boolean),
      };

  messages.push(
    new AIMessage({
      content: "",
      tool_calls: [
        { type: "tool_call", name: isAction ? approval.toolName : "ask_user", args, id: toolCallId },
      ],
    }),
  );

  if (!isAction) {
    // QUESTION: the human's answer IS the tool result the model is waiting on.
    messages.push(
      new ToolMessage({ tool_call_id: toolCallId, content: approval.response ?? "" }),
    );
  } else if (approval.status === "REJECTED") {
    // Rejected action: the model is told the truth and must pick another route.
    messages.push(
      new ToolMessage({
        tool_call_id: toolCallId,
        content: `The user rejected this action.${
          approval.response ? ` Their note: ${approval.response}` : ""
        }`,
      }),
    );
  }

  return messages;
}

// A per-request budget shared across the whole handoff chain so that limits
// apply to all teammate executions, not just one invocation.
function createExecutionBudget() {
  return {
    executions: 0,
    maxExecutions: config.handoffs.maxExecutionsPerRequest,
    maxDepth: config.handoffs.maxDepth,
    deadline: Date.now() + config.handoffs.timeoutMs,
  };
}

// Invoke the compiled graph once with fully server-resolved context. The
// handoff tool reads its trusted context from `configurable`.
async function invokeGraph({
  userId,
  chatId,
  botId,
  botJob,
  botInstructions,
  conversationHistory = [],
  message,
  participants = [],
  depth = 0,
  budget,
  signal,
  aiJobId = null,
  resumeApproval = null,
  maxToolCalls = null,
  deadlineAt = null,
}) {
  const toolBudget = resolveToolBudget(maxToolCalls);

  const input = {
    userId,
    chatId,
    botId,
    botJob,
    botInstructions,
    conversationHistory,
    message,
    participants,
    aiJobId,
    resumeApproval,
    maxToolCalls: toolBudget,
    deadlineAt,
    pendingApprovalId: null,
    bypassToolCallIds:
      resumeApproval &&
      resumeApproval.kind === "ACTION" &&
      resumeApproval.status === "APPROVED"
        ? [resumeApproval.toolCallId].filter(Boolean)
        : [],
  };

  // A resume seeds the message list up front (system + history + the deferred
  // call/answer pair); a fresh turn lets modelNode seed it on the first pass.
  if (resumeApproval) {
    input.messages = buildResumeMessages(input);
  }

  return agentGraph.invoke(input, {
    signal,
    recursionLimit: toolBudget * 2 + 20,
    configurable: {
      userId,
      chatId,
      botId,
      aiJobId,
      participants,
      depth,
      budget,
      runTeammate: runTeammateAgent,
      signal,
    },
  });
}

async function safelyFinishHandoff(id, status, result, error) {
  try {
    await finishHandoff({ id, status, result, error });
  } catch (persistError) {
    console.warn("Failed to record handoff result:", persistError?.message);
  }
}

// Execute a delegated teammate: persist the handoff, run the destination bot
// with its own job/instructions and only the delegated task as context, then
// record the outcome. Errors are recorded and rethrown so the initiating
// teammate receives the failure instead of a fabricated success.
async function runTeammateAgent({
  userId,
  chatId,
  fromBotId,
  toBot,
  task,
  depth = 0,
  budget,
  participants = [],
  signal,
}) {
  if (budget) {
    budget.executions += 1;
  }

  let record = null;
  try {
    record = await createHandoff({
      chatId,
      userId,
      fromBotId,
      toBotId: toBot.id,
      task,
      depth: depth + 1,
    });
  } catch (error) {
    // Recording failure must not abort the delegation, but it is never
    // reported as recorded. Only the message is logged.
    console.warn("Failed to record handoff start:", error?.message);
  }

  activityHandoff({ chatId, botId: fromBotId, to: toBot.name, task, phase: "start" });

  try {
    const state = await invokeGraph({
      userId,
      chatId,
      botId: toBot.id,
      botJob: toBot.job,
      botInstructions: toBot.instructions || "",
      conversationHistory: [],
      message: task,
      participants,
      depth: depth + 1,
      budget,
      signal,
    });

    if (state.pendingApprovalId) {
      // The delegated run paused on a human approval. The handoff cannot
      // complete now, so it is failed honestly (the caller's catch persists
      // that) and the parent round — which checks for the same pending
      // approval right after its tools — stops as well. After the user
      // answers, the resumed model re-issues this task with the answer.
      throw new Error(
        "The delegated task paused to ask the user a question and cannot continue until they answer.",
      );
    }

    const result = extractFinalResponse(state.messages);

    if (!result || result.trim().length === 0) {
      throw new Error("The teammate returned an empty response.");
    }

    if (record) {
      await safelyFinishHandoff(record.id, "SUCCEEDED", result, null);
    }

    activityHandoff({
      chatId,
      botId: fromBotId,
      to: toBot.name,
      task,
      phase: "finish",
    });

    return { ok: true, teammate: toBot.name, result };
  } catch (error) {
    if (record) {
      await safelyFinishHandoff(record.id, "FAILED", null, error?.message);
    }
    throw error;
  }
}

// Execute the agent workflow. Kept separate from Express route handling so the
// transport layer only deals with HTTP concerns. `userId`, `chatId`, `botId`
// and `participants` are trusted context supplied by the authenticated request,
// not by the model.
export async function generateAgentResponse({
  userId,
  chatId,
  botId = null,
  botJob,
  botInstructions,
  conversationHistory = [],
  message,
  participants = [],
  timeoutMs = config.handoffs.timeoutMs,
  aiJobId = null,
  resumeApproval = null,
  maxToolCalls = null,
}) {
  // The run gets a soft deadline: when it passes, the graph stops calling tools
  // and produces a truthful summary. The hard abort fires later as a backstop,
  // so a slow provider still cannot keep a run alive past its budget.
  const deadlineAt = Date.now() + timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs + config.agent.finalizeGraceMs,
  );
  const budget = createExecutionBudget();

  try {
    const state = await invokeGraph({
      userId,
      chatId,
      botId,
      botJob,
      botInstructions,
      conversationHistory,
      message,
      participants,
      depth: 0,
      budget,
      signal: controller.signal,
      aiJobId,
      resumeApproval,
      maxToolCalls,
      deadlineAt,
    });

    // A paused run reports the approval that stopped it so the caller can
    // surface the question and park the turn/job instead of finishing it.
    let pendingApproval = null;
    if (state.pendingApprovalId) {
      pendingApproval = await hasPendingApproval(chatId);
    }

    return { text: extractFinalResponse(state.messages), pendingApproval };
  } finally {
    clearTimeout(timer);
  }
}

export { agentGraph };
