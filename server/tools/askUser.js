import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createApproval, hasPendingApproval } from "../approvals.js";

// The ask_user tool is the agent's way to pause its own run and put a question
// in front of the human (ROADMAP.md Phase A).
//
// It does not block. Creating the PENDING ApprovalRequest IS the pause: the
// agent graph checks for a pending approval after every tool round and stops
// before calling the model again. The user's reply is later injected as the
// ToolMessage answering this very tool call, so from the model's point of view
// the call simply returned the human's answer.
//
// Trusted context (whose chat, whose teammate, which run) comes from the
// LangGraph runtime, never from model-generated arguments.

function getTrustedContext(runtime) {
  const configured = runtime?.config?.configurable ?? runtime?.configurable ?? {};
  const { userId, chatId, botId, aiJobId } = configured;

  if (!userId || !chatId) {
    console.warn("[ask-user] rejected call: missing trusted userId/chatId in runtime config");
    throw new Error("ask_user is not available in this context.");
  }

  return { userId, chatId, botId: botId ?? null, aiJobId: aiJobId ?? null };
}

export const askUserTool = tool(
  async (input, runtime) => {
    const { userId, chatId, botId, aiJobId } = getTrustedContext(runtime);

    // A chat can only be waiting on one approval at a time. If the previous
    // round already paused the run, do not stack a second question on top of
    // it — report that and let the graph stop on the existing approval.
    const existing = await hasPendingApproval(chatId);
    if (existing) {
      return {
        status: "already_waiting",
        question: existing.question,
        note: "The user is already being asked something. Wait for their reply; do not ask again.",
      };
    }

    const approval = await createApproval({
      userId,
      chatId,
      botId,
      aiJobId,
      kind: "QUESTION",
      question: input.question,
      options: input.options ?? [],
    });

    return {
      status: "waiting_for_user",
      approvalId: approval.id,
      note: "The question was sent to the user. This run now pauses; the user's reply will be returned here as your tool result.",
    };
  },
  {
    name: "ask_user",
    description:
      "Ask the user a question and pause the current run until they answer. " +
      "Use it whenever human input is genuinely required: choosing between " +
      "options, confirming an irreversible action (purchase, sending a message, " +
      "deleting data), requesting a login/OTP performed by the user, or any " +
      "ambiguity you must not guess. Keep the question short and offer concrete " +
      "options. The tool returns the user's answer.",
    schema: z.object({
      question: z
        .string()
        .min(2)
        .max(2000)
        .describe("The question to show the user, as one or two sentences."),
      options: z
        .array(z.string().min(1).max(200))
        .max(8)
        .optional()
        .describe("Up to 8 concrete answer options the user can tap directly."),
    }),
  },
);
