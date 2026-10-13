// Real-model verification: the same code path a deployed Trigger.dev worker
// executes (runAiJob), with NO mock — the configured OpenRouter model is really
// called, and the real Daytona sandbox/browser is used for the browser scenario.
//
//   SCENARIO=chat|tool|browser  node scripts/verify-real-model.mjs
//
// Use this when a background run sits QUEUED at the provider: it proves whether
// the *work* works, independently of whether a worker is deployed to pick up
// dispatched runs.

import { prisma } from "../server/prisma.js";
import { config } from "../server/config.js";
import { createJob, findJobById } from "../server/jobs.js";
import { runAiJob } from "../server/jobRunner.js";
import { findMessagesByChatId } from "../server/messages.js";
import { getBrowserStatus, relayFrameStream } from "../server/browser.js";

const SCENARIO = process.env.SCENARIO || "chat";

const GOALS = {
  chat: "Reply with exactly the single word READY and nothing else. Do not call any tools.",
  tool: "Create one task (todo) titled 'verification run' using your task tool, then reply with the word DONE and the task id.",
  browser:
    "Use your browser tools to open https://example.com and then tell me the page's main heading text. Report exactly what you saw, and nothing else.",
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// A minimal stand-in for an Express response, so the frame relay can be exercised
// exactly as the browser client exercises it.
function fakeResponse() {
  const chunks = [];
  return {
    chunks,
    headersSent: false,
    status() {
      return this;
    },
    setHeader() {
      return this;
    },
    flushHeaders() {
      this.headersSent = true;
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk).toString("utf8"));
      return true;
    },
    end() {
      this.ended = true;
    },
    on() {
      return this;
    },
  };
}

async function main() {
  const goal = GOALS[SCENARIO];
  if (!goal) throw new Error(`Unknown SCENARIO: ${SCENARIO}`);

  console.log(`=== real-model scenario: ${SCENARIO} ===`);
  console.log(`model: ${config.openRouter.model}`);
  console.log(`job budget: ${config.agent.maxToolCallsJob} tool calls, ${config.job.maxSteps} steps, ${config.job.maxDurationMs} ms`);
  console.log(`daytona configured: ${Boolean(config.daytona.apiKey)}`);

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: { name: "Real Check", email: `realcheck-${stamp}@test.local`, passwordHash: "x" },
  });
  const bot = await prisma.bot.create({
    data: {
      userId: user.id,
      name: `Real ${SCENARIO}`,
      avatar: "real",
      job: "Complete the user's request and report honestly.",
    },
  });
  const chat = await prisma.chat.create({
    data: { userId: user.id, botId: bot.id, title: `real-${SCENARIO}` },
  });

  const { job } = await createJob({
    userId: user.id,
    chatId: chat.id,
    botId: bot.id,
    message: goal,
    idempotencyKey: `real-${SCENARIO}-${stamp}`,
  });

  const started = Date.now();
  let runError = null;
  try {
    await runAiJob({ jobId: job.id, attemptCount: 1 });
  } catch (error) {
    runError = error;
  }
  const elapsed = Math.round((Date.now() - started) / 1000);

  const finished = await findJobById(job.id);
  const messages = await findMessagesByChatId(chat.id, user.id);
  const executions = await prisma.toolExecution.findMany({ where: { aiJobId: job.id } });
  const toolMessages = await prisma.message.count({ where: { chatId: chat.id, role: "TOOL" } });

  console.log("\n--- outcome ---");
  console.log("elapsed:", elapsed, "s | job status:", finished.status, "| steps:", finished.stepCount);
  console.log("result:", JSON.stringify((finished.result ?? "").slice(0, 400)));
  if (finished.error) console.log("error:", finished.error);
  if (runError) console.log("thrown:", runError.message);
  for (const execution of executions) {
    console.log(
      `tool: ${execution.toolName} ${execution.status} in ${execution.durationMs ?? "?"}ms -> ${(
        execution.result ?? execution.error ?? ""
      ).slice(0, 120)}`,
    );
  }

  check("job reached SUCCEEDED", finished.status === "SUCCEEDED", `status=${finished.status}`);
  check("the reply was persisted in the chat", messages.some((m) => m.role === "ASSISTANT"));

  if (SCENARIO === "chat") {
    check("the model's real answer is READY", /READY/i.test(finished.result ?? ""), finished.result?.slice(0, 80));
    check("no tools were invented", executions.length === 0, `executions=${executions.length}`);
  }

  if (SCENARIO === "tool") {
    check("a real tool execution was recorded", executions.length > 0, `executions=${executions.length}`);
    check(
      "all recorded executions succeeded",
      executions.every((execution) => execution.status === "SUCCEEDED"),
      executions.map((e) => `${e.toolName}:${e.status}`).join(","),
    );
    check("tool results were persisted as context", toolMessages > 0, `toolMessages=${toolMessages}`);
    check("the job counted its steps", finished.stepCount > 0, `stepCount=${finished.stepCount}`);
    check(
      "the transcript hides TOOL rows",
      messages.every((m) => m.role !== "TOOL"),
      `messages=${messages.length}`,
    );
    const created = await prisma.todo.count({ where: { userId: user.id } });
    check("the task actually exists in the database", created > 0, `todos=${created}`);
  }

  if (SCENARIO === "browser") {
    check("a browser tool ran", executions.some((e) => e.toolName.startsWith("browser_")), executions.map((e) => e.toolName).join(","));
    check(
      "the browser tool succeeded",
      executions.some((e) => e.toolName.startsWith("browser_") && e.status === "SUCCEEDED"),
    );

    // The live view the frontend renders: state, then a real frame off the wire.
    const status = await getBrowserStatus({ userId: user.id, botId: bot.id });
    check("browser session reports ready", status.ready === true, `ready=${status.ready} url=${status.url ?? "-"}`);
    console.log("controlMode:", status.controlMode, "| viewport:", JSON.stringify(status.viewport));

    if (status.ready) {
      const res = fakeResponse();
      const controller = new AbortController();
      const stop = setTimeout(() => controller.abort(), 12000);
      await relayFrameStream({
        userId: user.id,
        botId: bot.id,
        res,
        signal: controller.signal,
      }).catch(() => {});
      clearTimeout(stop);
      const stream = res.chunks.join("");
      const frames = (stream.match(/data: \{/g) ?? []).length;
      check("the live view stream produced frames", frames > 0, `chunks=${res.chunks.length} frames=${frames}`);
      const first = stream.match(/data: (\{.*\})/);
      if (first) {
        try {
          const parsed = JSON.parse(first[1]);
          check("frame carries a JPEG and the viewport size", Boolean(parsed.jpeg) && Boolean(parsed.viewport?.width), `viewport=${JSON.stringify(parsed.viewport)}`);
        } catch {
          check("frame is valid JSON", false);
        }
      }
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("verify-real-model failed:", error);
  process.exit(1);
});
