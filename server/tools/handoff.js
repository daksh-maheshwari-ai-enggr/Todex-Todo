import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Trusted execution context is injected by server-side code through the
// LangGraph runtime config (`configurable`). It is never read from the
// model-generated tool arguments, so the model cannot pick the user, chat, or
// teammates it is allowed to delegate to.
function getTrustedContext(runtime) {
  const configured = runtime?.config?.configurable ?? runtime?.configurable ?? {};
  return configured;
}

// Factory so the agent can inject the recursive teammate runner without a
// circular module dependency. `runTeammate` executes the destination teammate
// and returns a structured result.
export function createHandoffTool({ runTeammate }) {
  return tool(
    async (input, runtime) => {
      const ctx = getTrustedContext(runtime);
      const { userId, chatId, botId, participants = [], depth = 0, budget } = ctx;

      if (!runTeammate || !userId || !chatId || !botId) {
        throw new Error("Teammate handoff is not available in this context.");
      }

      const { toBotId } = input;
      if (toBotId === botId) {
        throw new Error("Cannot hand off a task to yourself.");
      }

      // The destination must be a validated participant of this chat, resolved
      // server-side. Model-supplied ids cannot introduce foreign teammates.
      const destination = (participants || []).find((p) => p.id === toBotId);
      if (!destination) {
        throw new Error("Destination teammate is not a participant in this chat.");
      }

      if (budget) {
        if (depth >= budget.maxDepth) {
          throw new Error(`Maximum handoff depth (${budget.maxDepth}) reached.`);
        }
        if (budget.executions >= budget.maxExecutions) {
          throw new Error("Maximum teammate executions reached for this request.");
        }
        if (Date.now() >= budget.deadline) {
          throw new Error("Handoff time budget exceeded for this request.");
        }
      }

      return runTeammate({
        userId,
        chatId,
        fromBotId: botId,
        toBot: destination,
        task: input.task,
        depth,
        budget,
        participants,
        signal: runtime?.config?.signal,
      });
    },
    {
      name: "handoff_to_teammate",
      description:
        "Delegate a task to another teammate participating in this chat. Use " +
        "when the request is better handled by a teammate with a different job. " +
        "Provide the teammate id from the available teammates list and a clear " +
        "task describing what they should do.",
      schema: z.object({
        toBotId: z.string().min(1).describe("The id of the teammate to delegate to."),
        task: z
          .string()
          .min(1)
          .max(2000)
          .describe("The task to hand off, including the context they need."),
      }),
    },
  );
}
