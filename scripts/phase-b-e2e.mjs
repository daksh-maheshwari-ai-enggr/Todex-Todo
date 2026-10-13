// Phase B end-to-end verification (ROADMAP.md §4).
//
// Runs the REAL server modules (jobs.js, jobRunner.js, agent.js, memory.js,
// messages.js) against the REAL database, with a mock OpenAI-compatible LLM at
// the provider boundary so the run is scripted and deterministic. The mock also
// records how many tool results it received, which is what proves that a retried
// or resumed run sees the work it already did.
//
// Scenarios (SCENARIO env): long | budget | resume | pause

import http from "node:http";

const SCENARIO = process.env.SCENARIO || "long";
const MOCK_PORT = Number(process.env.MOCK_PORT) || 3998;
const TARGET_ROUNDS = Number(process.env.MOCK_TARGET_ROUNDS) || 45;
const ABORT_AT = Number(process.env.MOCK_ABORT_AT) || 0;

process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
process.env.OPENROUTER_API_KEY = "mock-key";
process.env.OPENROUTER_MODEL = "mock-model";
process.env.OPENROUTER_TIMEOUT_MS = process.env.OPENROUTER_TIMEOUT_MS || "60000";
process.env.AGENT_FINALIZE_GRACE_MS = "5000";

const mockState = { maxPriorResults: 0, requests: 0, aborted: 0, stopNotices: 0 };
// The provider client retries a failed request internally, so the injected crash
// is an open window rather than a single aborted request: every request inside
// the window dies, which is what makes the first attempt fail for real. The
// harness closes the window before the retried attempt, so the retry is served.
let crashWindow = ABORT_AT > 0;

function startMock() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch {
        /* ignore */
      }

      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      const priorResults = messages.filter((message) => message.role === "tool").length;
      mockState.requests += 1;
      mockState.maxPriorResults = Math.max(mockState.maxPriorResults, priorResults);

      // Injected crash: the provider connection dies mid-run. One-shot, so the
      // retried attempt is served normally (that is what "a provider recovered"
      // looks like to the runner).
      if (crashWindow && priorResults >= ABORT_AT) {
        mockState.aborted += 1;
        res.destroy();
        return;
      }

      const stopNotice = messages.some(
        (message) =>
          typeof message.content === "string" && message.content.includes("Stop calling tools"),
      );
      if (stopNotice) mockState.stopNotices += 1;

      let message;
      let finishReason;

      if (stopNotice) {
        message = {
          role: "assistant",
          content: `STOPPED after ${priorResults} tool rounds: the run hit its budget before finishing.`,
        };
        finishReason = "stop";
      } else if (SCENARIO === "pause") {
        const answered = messages.some(
          (m) => m.role === "tool" && typeof m.content === "string" && m.content.includes("Window"),
        );
        if (answered) {
          message = { role: "assistant", content: "Booked: window seat confirmed (answer received)." };
          finishReason = "stop";
        } else {
          message = {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-ask-1",
                type: "function",
                function: {
                  name: "ask_user",
                  arguments: JSON.stringify({
                    question: "Which seat should I book?",
                    options: ["Window", "Aisle"],
                  }),
                },
              },
            ],
          };
          finishReason = "tool_calls";
        }
      } else if (priorResults < TARGET_ROUNDS) {
        message = {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call-${priorResults + 1}`,
              type: "function",
              function: { name: "todo_list", arguments: "{}" },
            },
          ],
        };
        finishReason = "tool_calls";
      } else {
        message = {
          role: "assistant",
          content: `Completed ${priorResults} tool rounds and finished the task.`,
        };
        finishReason = "stop";
      }

      const response = {
        id: `chatcmpl-${mockState.requests}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "mock-model",
        choices: [{ index: 0, message, finish_reason: finishReason }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });

  return new Promise((resolve) => server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server)));
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// Server modules are imported by absolute path, defaulting to the project root
// this script lives in (scripts/..). Run it from the project root so .env is
// picked up, e.g.:
//
//   SCENARIO=long MOCK_PORT=4123 MOCK_TARGET_ROUNDS=45 \
//     AGENT_MAX_TOOL_CALLS_JOB=60 JOB_MAX_STEPS=70 \
//     node scripts/phase-b-e2e.mjs
//
const ROOT = process.env.PROJECT_ROOT || new URL("..", import.meta.url).pathname;

async function main() {
  if (!ROOT) throw new Error("PROJECT_ROOT must point at the project root.");
  const server = await startMock();

  const { prisma } = await import(`${ROOT}/server/prisma.js`);
  const { createJob, findJobById, finishJob, listJobSteps, resolveAppStatus } = await import(
    `${ROOT}/server/jobs.js`
  );
  const { runAiJob } = await import(`${ROOT}/server/jobRunner.js`);
  const { findMessagesByChatId } = await import(`${ROOT}/server/messages.js`);
  const { respondApproval } = await import(`${ROOT}/server/approvals.js`);

  const stamp = Date.now();
  const user = await prisma.user.create({
    data: { name: "Phase B", email: `phaseb-${SCENARIO}-${stamp}@test.local`, passwordHash: "x" },
  });
  const bot = await prisma.bot.create({
    data: {
      userId: user.id,
      name: `Runner ${SCENARIO}`,
      avatar: "runner",
      job: "Complete a long multi-step task and report honestly.",
    },
  });
  const chat = await prisma.chat.create({
    data: { userId: user.id, botId: bot.id, title: `phase-b-${SCENARIO}` },
  });

  const { job } = await createJob({
    userId: user.id,
    chatId: chat.id,
    botId: bot.id,
    message: "Work through the checklist and report what you did.",
    idempotencyKey: `phase-b-${SCENARIO}-${stamp}`,
  });

  console.log(`\n=== scenario ${SCENARIO} (job ${job.id}) ===`);

  if (SCENARIO === "long" || SCENARIO === "budget" || SCENARIO === "pause") {
    const result = await runAiJob({ jobId: job.id, attemptCount: 1 });
    const after = await findJobById(job.id);
    const steps = await listJobSteps({ userId: user.id, jobId: job.id });

    if (SCENARIO === "long") {
      check("job succeeded", result.status === "SUCCEEDED" && after.status === "SUCCEEDED", result.status);
      check(
        `ran ${TARGET_ROUNDS} tool rounds`,
        after.stepCount === TARGET_ROUNDS,
        `stepCount=${after.stepCount}`,
      );
      check(
        "every round recorded against the job",
        steps.steps.filter((s) => s.type === "tool").length === TARGET_ROUNDS,
        `steps=${steps.steps.length}`,
      );
      check(
        "tool rounds attributed to the job row (aiJobId)",
        (await prisma.toolExecution.count({ where: { aiJobId: job.id } })) === TARGET_ROUNDS,
      );
      check(
        "tool results persisted as TOOL messages",
        (await prisma.message.count({ where: { chatId: chat.id, role: "TOOL" } })) === TARGET_ROUNDS,
      );
      const transcript = await findMessagesByChatId(chat.id, user.id);
      check(
        "chat transcript hides TOOL rows",
        transcript.every((m) => m.role !== "TOOL"),
        `messages=${transcript.length}`,
      );
      check(
        "one user message, one assistant reply",
        transcript.filter((m) => m.role === "USER").length === 1 &&
          transcript.filter((m) => m.role === "ASSISTANT").length === 1,
      );
      check(
        "the model saw prior tool results as context",
        mockState.maxPriorResults >= TARGET_ROUNDS - 1,
        `maxPriorResults=${mockState.maxPriorResults}`,
      );
      check("no step-budget stop was triggered", mockState.stopNotices === 0);
      check("result is the real completion", /Completed 45 tool rounds/.test(after.result ?? ""), after.result);
    }

    if (SCENARIO === "budget") {
      check("job finished (no error loop)", after.status === "SUCCEEDED", after.status);
      check(
        "stopped at the job's lifetime step budget",
        after.stepCount === 5,
        `stepCount=${after.stepCount} (JOB_MAX_STEPS=5)`,
      );
      check("the model was told why it stopped", mockState.stopNotices >= 1);
      check(
        "summary is honest, not an invented success",
        /^STOPPED after \d+ tool rounds/.test(after.result ?? ""),
        after.result,
      );
      check("no retry was needed", after.attemptCount === 1, `attempts=${after.attemptCount}`);
    }

    if (SCENARIO === "pause") {
      check("job parked on the approval", after.status === "WAITING_FOR_USER", after.status);
      check("approval id is exposed for the UI", Boolean(after.lastApprovalId));
      check("waitSince recorded", Boolean(after.waitSince));

      const parkedAgain = await runAiJob({ jobId: job.id });
      const stillParked = await findJobById(job.id);
      check(
        "a retried attempt does not restart a parked job",
        parkedAgain.waitingForUser === true && stillParked.status === "WAITING_FOR_USER",
        `status=${stillParked.status}`,
      );
      check(
        "restarting it wrote no second user message",
        (await prisma.message.count({ where: { chatId: chat.id, role: "USER" } })) === 1,
      );

      const forced = await finishJob({ jobId: job.id, status: "FAILED", error: "should be ignored" });
      check(
        "FAILED cannot overwrite WAITING_FOR_USER",
        forced.status === "WAITING_FOR_USER",
        `status=${forced.status}`,
      );
      check(
        "reconciliation cannot overwrite WAITING_FOR_USER",
        resolveAppStatus("WAITING_FOR_USER", "COMPLETED") === "WAITING_FOR_USER",
      );

      const approval = await respondApproval({
        approvalId: after.lastApprovalId,
        userId: user.id,
        answer: "Window",
      });
      const resumed = await runAiJob({ jobId: job.id, resumeApprovalId: approval.id });
      const done = await findJobById(job.id);
      check("resume continued the same job", resumed.status === "SUCCEEDED", `${resumed.status}`);
      check(
        "the answer reached the model inside the resumed run",
        /answer received/.test(done.result ?? ""),
        done.result,
      );
      const approvalSteps = (await listJobSteps({ userId: user.id, jobId: job.id })).steps.filter(
        (s) => s.type === "approval",
      );
      check("the pause appears in the job timeline", approvalSteps.length === 1, `steps=${approvalSteps.length}`);
    }
  }

  if (SCENARIO === "resume") {
    crashWindow = true;
    let crashed = null;
    try {
      await runAiJob({ jobId: job.id, attemptCount: 1 });
    } catch (error) {
      crashed = error;
    }
    crashWindow = false;
    const afterCrash = await findJobById(job.id);
    check("the first attempt really failed on the provider", Boolean(crashed), crashed?.message);
    check(
      "the completed tool work survived the crash",
      afterCrash.stepCount === ABORT_AT,
      `stepCount=${afterCrash.stepCount} (aborted after ${ABORT_AT})`,
    );
    check(
      "no reply was persisted by the failed attempt",
      (await prisma.message.count({ where: { chatId: chat.id, role: "ASSISTANT" } })) === 0,
    );
    check("job is not left terminal", afterCrash.status === "RUNNING", afterCrash.status);

    const usersBefore = await prisma.message.count({ where: { chatId: chat.id, role: "USER" } });
    const retry = await runAiJob({ jobId: job.id, attemptCount: 2 });
    const after = await findJobById(job.id);
    const transcript = await findMessagesByChatId(chat.id, user.id);

    check("the retry completed the job", retry.status === "SUCCEEDED" && after.status === "SUCCEEDED");
    check(
      "the retry continued instead of restarting",
      after.stepCount === TARGET_ROUNDS,
      `stepCount=${after.stepCount} (target ${TARGET_ROUNDS})`,
    );
    check(
      "the retry saw the earlier tool results",
      mockState.maxPriorResults >= ABORT_AT,
      `maxPriorResults=${mockState.maxPriorResults}, abortedRequests=${mockState.aborted}`,
    );
    check(
      "the user message was not duplicated",
      (await prisma.message.count({ where: { chatId: chat.id, role: "USER" } })) === usersBefore,
    );
    check(
      "exactly one assistant reply for the job",
      transcript.filter((m) => m.role === "ASSISTANT").length === 1,
      `${transcript.filter((m) => m.role === "ASSISTANT").length} replies`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) console.log(`failures:\n${failed.map((f) => ` - ${f.name} (${f.detail})`).join("\n")}`);

  server.close();
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("harness error:", error);
  process.exit(1);
});
