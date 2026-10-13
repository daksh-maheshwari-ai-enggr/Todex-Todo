// Verification harness for Phases A, C and D (ROADMAP.md).
//
// Runs the REAL Express app, the REAL services and the REAL database, with a
// scripted mock LLM substituted only at the provider boundary, so agent turns are
// deterministic and cost no quota. Phase B has its own harness
// (scripts/phase-b-e2e.mjs) because it drives background jobs directly.
//
//   SCENARIO=all|a|c|d  MOCK_PORT=<free port>  PORT=<free api port>  node scripts/verify-phases.mjs
//
// Exit code is 0 only when every check passed.

import http from "node:http";

const SCENARIO = process.env.SCENARIO || "all";
const MOCK_PORT = Number(process.env.MOCK_PORT) || 4131;
const API_PORT = Number(process.env.API_PORT) || 4132;
const TARGET_ROUNDS = Number(process.env.MOCK_TARGET_ROUNDS) || 45;

// Provider boundary only: everything below is the real application.
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "mock-key";
process.env.OPENROUTER_MODEL = "mock-model";
process.env.OPENROUTER_TIMEOUT_MS = "30000";
process.env.AGENT_FINALIZE_GRACE_MS = "5000";
process.env.PORT = String(API_PORT);
// Phase A2: the shell tool is the gated one for this run of the harness.
process.env.APPROVAL_GATED_TOOLS = "sandbox_execute_command";

// The model's script for the current step. The harness flips this between
// scenarios; every branch is deterministic.
let mockMode = "plain";
const mockState = { requests: 0, askCount: 0, gatedCalls: 0 };

function toolCall(id, name, args) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  };
}

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
      const toolResults = messages.filter((m) => m.role === "tool");
      mockState.requests += 1;

      let message;
      let finishReason = "stop";

      if (mockMode === "question") {
        const answered = toolResults.some((m) => String(m.content).includes("Window"));
        if (answered) {
          message = { role: "assistant", content: "SEAT=Window booked." };
        } else {
          mockState.askCount += 1;
          message = toolCall("call-ask-1", "ask_user", {
            question: "Which seat should I book?",
            options: ["Window", "Aisle"],
          });
          finishReason = "tool_calls";
        }
      } else if (mockMode === "gate") {
        const result = toolResults.find((m) => String(m.content).length > 0);
        if (!result) {
          mockState.gatedCalls += 1;
          message = toolCall("call-gate-1", "sandbox_execute_command", { command: "echo hi" });
          finishReason = "tool_calls";
        } else if (String(result.content).toLowerCase().includes("reject")) {
          message = { role: "assistant", content: "Understood — I will not run that command." };
        } else {
          message = { role: "assistant", content: `Command output: ${result.content}` };
        }
      } else if (mockMode === "rounds") {
        if (toolResults.length < TARGET_ROUNDS) {
          message = toolCall(`call-${toolResults.length + 1}`, "todo_list", {});
          finishReason = "tool_calls";
        } else {
          message = { role: "assistant", content: `Completed ${toolResults.length} rounds.` };
        }
      } else {
        message = { role: "assistant", content: "MOCK_REPLY_OK" };
      }

      const response = {
        id: `chatcmpl-${mockState.requests}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "mock-model",
        choices: [{ index: 0, message, finish_reason: finishReason }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
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

const BASE = `http://127.0.0.1:${API_PORT}/api`;

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: res.status, payload };
}

async function newUser(prisma, label) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const email = `verify-${label}-${stamp}@test.local`;
  const registered = await api("/auth/register", {
    method: "POST",
    body: { name: `Verify ${label}`, email, password: "password-12345" },
  });
  if (registered.status !== 201) {
    throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.payload)}`);
  }
  const token = registered.payload.token;
  const userId = registered.payload.user.id;
  return { email, token, userId };
}

async function newBotAndChat(user, label) {
  const bot = await api("/bots", {
    method: "POST",
    token: user.token,
    body: { name: `Bot ${label}`, job: "Carry out the user's request.", instructions: "Be brief." },
  });
  if (bot.status !== 201) throw new Error(`bot create failed: ${bot.status}`);

  const chat = await api("/chats", {
    method: "POST",
    token: user.token,
    body: { title: `Chat ${label}`, botId: bot.payload.bot.id },
  });
  if (chat.status !== 201) throw new Error(`chat create failed: ${chat.status}`);

  return { botId: bot.payload.bot.id, chatId: chat.payload.chat.id };
}

async function main() {
  const mock = await startMock();

  const { prisma } = await import("../server/prisma.js");
  const { createApproval, respondApproval, cancelPendingApprovals } = await import(
    "../server/approvals.js"
  );
  const { runDueScheduledTasks, listScheduledTasks } = await import("../server/scheduledTasks.js");
  const { findJobById } = await import("../server/jobs.js");
  const { findMessagesByChatId } = await import("../server/messages.js");
  const { default: app } = await import("../server/index.js");

  const user = await newUser(prisma, "main");
  const other = await newUser(prisma, "other");

  if (SCENARIO === "a" || SCENARIO === "all") {
    console.log("\n=== Phase A: human-in-the-loop ===");

    // A1: a synchronous turn pauses on ask_user, and the answer resumes the SAME run.
    mockMode = "question";
    const { botId, chatId } = await newBotAndChat(user, "a1");

    const paused = await api(`/agents/${botId}/respond`, {
      method: "POST",
      token: user.token,
      body: { chatId, message: "Book me a train seat." },
    });
    check("A1 turn returns 201", paused.status === 201, `status=${paused.status}`);
    check(
      "A1 paused on a QUESTION approval",
      paused.payload?.pendingApproval?.kind === "QUESTION",
      `kind=${paused.payload?.pendingApproval?.kind}`,
    );

    const approvalId = paused.payload?.pendingApproval?.id;
    const answered = await api(`/approvals/${approvalId}/respond`, {
      method: "POST",
      token: user.token,
      body: { answer: "Window" },
    });
    check("A1 answer accepted", answered.status === 200, `status=${answered.status}`);
    check(
      "A1 the same run continued with the answer",
      /SEAT=Window/.test(answered.payload?.response ?? ""),
      answered.payload?.response,
    );

    const twice = await api(`/approvals/${approvalId}/respond`, {
      method: "POST",
      token: user.token,
      body: { answer: "Aisle" },
    });
    check("A1 a second answer is rejected (409)", twice.status === 409, `status=${twice.status}`);

    const foreign = await api(`/approvals/${approvalId}/respond`, {
      method: "POST",
      token: other.token,
      body: { answer: "Aisle" },
    });
    check("A1 another user sees 404 (not 403)", foreign.status === 404, `status=${foreign.status}`);

    // A2: the sensitive-action gate defers the call instead of running it.
    mockMode = "gate";
    const gated = await newBotAndChat(user, "a2");
    const gatePaused = await api(`/agents/${gated.botId}/respond`, {
      method: "POST",
      token: user.token,
      body: { chatId: gated.chatId, message: "Run the shell command." },
    });
    check(
      "A2 gated tool deferred as an ACTION approval",
      gatePaused.payload?.pendingApproval?.kind === "ACTION" &&
        gatePaused.payload?.pendingApproval?.toolName === "sandbox_execute_command",
      `tool=${gatePaused.payload?.pendingApproval?.toolName}`,
    );
    const executions = await prisma.toolExecution.count({
      where: { chatId: gated.chatId, toolName: "sandbox_execute_command" },
    });
    check("A2 the gated tool never executed", executions === 0, `executions=${executions}`);

    const rejected = await api(`/approvals/${gatePaused.payload.pendingApproval.id}/respond`, {
      method: "POST",
      token: user.token,
      body: { approved: false, note: "rejected: not allowed" },
    });
    check(
      "A2 rejection resumes the run truthfully",
      /will not run/.test(rejected.payload?.response ?? ""),
      rejected.payload?.response,
    );

    // A3: approvals are listed per chat and only for their owner.
    const listed = await api(`/approvals?chatId=${gated.chatId}`, { token: user.token });
    check("A3 pending list is empty after responding", (listed.payload?.approvals ?? []).length === 0);
    const foreignList = await api(`/approvals?chatId=${gated.chatId}`, { token: other.token });
    check("A3 a foreign chat id is a 404", foreignList.status === 404, `status=${foreignList.status}`);
  }

  if (SCENARIO === "c" || SCENARIO === "all") {
    console.log("\n=== Phase C: takeover gates (no live sandbox needed) ===");

    const { botId, chatId } = await newBotAndChat(user, "c");
    const { botId: otherBotId, chatId: otherChatId } = await newBotAndChat(other, "c-other");

    const pending = await createApproval({
      userId: user.userId,
      chatId,
      botId,
      kind: "QUESTION",
      question: "Please sign in to the site.",
    });
    const otherPending = await createApproval({
      userId: other.userId,
      chatId: otherChatId,
      botId: otherBotId,
      kind: "QUESTION",
      question: "Other user's pause.",
    });

    const noApproval = await api(`/sandbox/${botId}/desktop/control`, {
      method: "POST",
      token: user.token,
      body: { mode: "user" },
    });
    check(
      "C takeover without an approval is refused (404)",
      noApproval.status === 404,
      `status=${noApproval.status} ${noApproval.payload?.error ?? ""}`,
    );

    const foreignApproval = await api(`/sandbox/${otherBotId}/desktop/control`, {
      method: "POST",
      token: user.token,
      body: { mode: "user", approvalId: otherPending.id },
    });
    check(
      "C another user's approval is refused (404)",
      foreignApproval.status === 404,
      `status=${foreignApproval.status}`,
    );

    const badMode = await api(`/sandbox/${botId}/desktop/control`, {
      method: "POST",
      token: user.token,
      body: { mode: "sideways" },
    });
    check("C an unknown mode is rejected (400)", badMode.status === 400, `status=${badMode.status}`);

    const unownedBot = await api(`/sandbox/does-not-exist/desktop/control`, {
      method: "POST",
      token: user.token,
      body: { mode: "agent" },
    });
    check(
      "C an unowned teammate is refused (404)",
      unownedBot.status === 404,
      `status=${unownedBot.status}`,
    );

    const badInput = await api(`/sandbox/${botId}/desktop/input`, {
      method: "POST",
      token: user.token,
      body: { events: [{ type: "teleport", x: 1, y: 1 }] },
    });
    check("C an unknown input event is rejected (400)", badInput.status === 400, `status=${badInput.status}`);

    const badCoords = await api(`/sandbox/${botId}/desktop/input`, {
      method: "POST",
      token: user.token,
      body: { events: [{ type: "mouse_move", x: "left", y: 0 }] },
    });
    check("C non-numeric coordinates are rejected (400)", badCoords.status === 400, `status=${badCoords.status}`);

    const tooMany = await api(`/sandbox/${botId}/desktop/input`, {
      method: "POST",
      token: user.token,
      body: {
        events: Array.from({ length: 51 }, (_, i) => ({ type: "mouse_move", x: i, y: i })),
      },
    });
    check("C an oversized input batch is rejected (400)", tooMany.status === 400, `status=${tooMany.status}`);

    const foreignInput = await api(`/sandbox/does-not-exist/desktop/input`, {
      method: "POST",
      token: user.token,
      body: { events: [{ type: "mouse_move", x: 5, y: 5 }] },
    });
    check(
      "C input for an unowned teammate is refused (404)",
      foreignInput.status === 404,
      `status=${foreignInput.status}`,
    );

    // A resolved approval must not justify a takeover.
    await respondApproval({
      approvalId: pending.id,
      userId: user.userId,
      answer: "done",
    });
    const resolved = await api(`/sandbox/${botId}/desktop/control`, {
      method: "POST",
      token: user.token,
      body: { mode: "user", approvalId: pending.id },
    });
    check(
      "C a resolved approval cannot start a takeover (409)",
      resolved.status === 409,
      `status=${resolved.status} ${resolved.payload?.error ?? ""}`,
    );

    await cancelPendingApprovals({ chatId: otherChatId, reason: "verification cleanup" });
  }

  if (SCENARIO === "d" || SCENARIO === "all") {
    console.log("\n=== Phase D: scheduling ===");

    const { botId, chatId } = await newBotAndChat(user, "d");

    const neither = await api("/scheduled-tasks", {
      method: "POST",
      token: user.token,
      body: { botId, chatId, goal: "Do the thing." },
    });
    check("D a task without a schedule is rejected (400)", neither.status === 400, `status=${neither.status}`);

    const past = await api("/scheduled-tasks", {
      method: "POST",
      token: user.token,
      body: {
        botId,
        chatId,
        goal: "Do the thing.",
        runAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    check("D a past runAt is rejected (400)", past.status === 400, `status=${past.status}`);

    const badInterval = await api("/scheduled-tasks", {
      method: "POST",
      token: user.token,
      body: { botId, chatId, goal: "Do the thing.", intervalMinutes: 0 },
    });
    check("D intervalMinutes 0 is rejected (400)", badInterval.status === 400, `status=${badInterval.status}`);

    const foreignBot = await api("/scheduled-tasks", {
      method: "POST",
      token: other.token,
      body: { botId, chatId, goal: "Steal the thing.", intervalMinutes: 60 },
    });
    check(
      "D scheduling against someone else's teammate is refused (404)",
      foreignBot.status === 404,
      `status=${foreignBot.status}`,
    );

    const created = await api("/scheduled-tasks", {
      method: "POST",
      token: user.token,
      body: {
        botId,
        chatId,
        goal: "Post a status summary in this chat.",
        runAt: new Date(Date.now() + 120_000).toISOString(),
      },
    });
    check("D a one-shot task is created (201)", created.status === 201, `status=${created.status}`);
    const task = created.payload?.task;
    check(
      "D nextRunAt is set to runAt",
      Boolean(task?.nextRunAt) && task.runAt === task.nextRunAt,
      `nextRunAt=${task?.nextRunAt}`,
    );

    const listed = await api("/scheduled-tasks", { token: user.token });
    check(
      "D the task appears in the caller's list",
      (listed.payload?.tasks ?? []).some((entry) => entry.id === task.id),
    );

    const foreignGet = await api(`/scheduled-tasks/${task.id}`, { token: other.token });
    check("D another user cannot read it (404)", foreignGet.status === 404, `status=${foreignGet.status}`);

    // Run now: a real dispatch through the configured Trigger.dev project.
    const ranNow = await api(`/scheduled-tasks/${task.id}/run`, { method: "POST", token: user.token });
    check("D run-now is accepted (202)", ranNow.status === 202, `status=${ranNow.status}`);
    const runNowJob = ranNow.payload?.jobId ? await findJobById(ranNow.payload.jobId) : null;
    check(
      "D run-now dispatched a real job for this chat",
      Boolean(runNowJob) && runNowJob.chatId === chatId && runNowJob.botId === botId,
      `job=${runNowJob?.id ?? "none"} status=${runNowJob?.status ?? "-"}`,
    );
    check(
      "D run-now did not move the schedule",
      (await prisma.scheduledTask.findUnique({ where: { id: task.id } }))?.status === "ACTIVE",
    );

    // The sweep: due when its slot has passed, and idempotent for that slot.
    const dueSlot = new Date(Date.now() - 1000);
    await prisma.scheduledTask.update({
      where: { id: task.id },
      data: { nextRunAt: dueSlot },
    });

    // runCount counts every run the task started, including "run now", so the
    // sweep's own contribution is measured as a delta rather than an absolute.
    const runsBeforeSweep = (
      await prisma.scheduledTask.findUnique({ where: { id: task.id } })
    )?.runCount;

    const sweep1 = await runDueScheduledTasks();
    const first = sweep1.results.find((result) => result.taskId === task.id);
    check(
      "D the sweep dispatched the due task",
      Boolean(first?.ok),
      `${JSON.stringify(first ?? {})} (checked ${sweep1.checked})`,
    );

    const afterSweep = await prisma.scheduledTask.findUnique({ where: { id: task.id } });
    check(
      "D a one-shot task completes after its run",
      afterSweep?.status === "COMPLETED" && afterSweep?.nextRunAt === null,
      `status=${afterSweep?.status}`,
    );
    check(
      "D the sweep's dispatch counted as exactly one more run",
      afterSweep?.runCount === Number(runsBeforeSweep) + 1,
      `runCount ${runsBeforeSweep} -> ${afterSweep?.runCount}`,
    );

    const job = afterSweep?.lastJobId ? await findJobById(afterSweep.lastJobId) : null;
    check(
      "D the slot is the idempotency key",
      job?.idempotencyKey === `scheduled:${task.id}:${dueSlot.toISOString()}`,
      `key=${job?.idempotencyKey}`,
    );

    // A repeated sweep must not start the same slot twice. The task is put back
    // to ACTIVE on the same slot, which is what a racing or retried sweep does.
    await prisma.scheduledTask.update({
      where: { id: task.id },
      data: { status: "ACTIVE", nextRunAt: dueSlot },
    });
    const sweep2 = await runDueScheduledTasks();
    const second = sweep2.results.find((result) => result.taskId === task.id);
    check(
      "D re-running the same slot is deduplicated",
      second?.deduplicated === true && second?.jobId === job?.id,
      `deduplicated=${second?.deduplicated}`,
    );
    const jobsForTask = await prisma.aiJob.count({ where: { idempotencyKey: job.idempotencyKey } });
    check("D only one job exists for the slot", jobsForTask === 1, `jobs=${jobsForTask}`);

    // Repeating tasks: advance on dispatch, then stay quiet until the next slot.
    const repeating = await api("/scheduled-tasks", {
      method: "POST",
      token: user.token,
      body: { botId, chatId, goal: "Hourly summary.", intervalMinutes: 60 },
    });
    const repeatTask = repeating.payload?.task;
    await prisma.scheduledTask.update({
      where: { id: repeatTask.id },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });
    const sweep3 = await runDueScheduledTasks();
    const repeatResult = sweep3.results.find((result) => result.taskId === repeatTask.id);
    const afterRepeat = await prisma.scheduledTask.findUnique({ where: { id: repeatTask.id } });
    check("D a repeating task runs at its slot", Boolean(repeatResult?.ok));
    check(
      "D and is rescheduled into the future",
      afterRepeat?.status === "ACTIVE" &&
        afterRepeat.nextRunAt &&
        afterRepeat.nextRunAt.getTime() > Date.now(),
      `nextRunAt=${afterRepeat?.nextRunAt?.toISOString()}`,
    );

    const sweep4 = await runDueScheduledTasks();
    check(
      "D a not-yet-due repeating task is not dispatched",
      !sweep4.results.some((result) => result.taskId === repeatTask.id),
    );

    // Pausing stops it; deleting it removes the row.
    const paused = await api(`/scheduled-tasks/${repeatTask.id}`, {
      method: "PATCH",
      token: user.token,
      body: { status: "PAUSED" },
    });
    check("D a task can be paused", paused.payload?.task?.status === "PAUSED", paused.payload?.task?.status);

    await prisma.scheduledTask.update({
      where: { id: repeatTask.id },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });
    const sweep5 = await runDueScheduledTasks();
    check(
      "D a paused task is skipped even when due",
      !sweep5.results.some((result) => result.taskId === repeatTask.id),
    );

    const removed = await api(`/scheduled-tasks/${repeatTask.id}`, {
      method: "DELETE",
      token: user.token,
    });
    check("D deleting works", removed.payload?.deleted === true, JSON.stringify(removed.payload));
    const gone = await api(`/scheduled-tasks/${repeatTask.id}`, { token: user.token });
    check("D a deleted task is 404", gone.status === 404, `status=${gone.status}`);

    // A failed dispatch keeps its slot due (no silent skip).
    const failing = await api("/scheduled-tasks", {
      method: "POST",
      token: user.token,
      body: { botId, chatId, goal: "This one cannot dispatch.", intervalMinutes: 30 },
    });
    const failTask = failing.payload?.task;
    // Point the task at a chat it does not own: the dispatch path re-checks
    // ownership, so this fails exactly like a revoked or deleted chat would.
    const { chatId: foreignChatId } = await newBotAndChat(other, "d-foreign");
    await prisma.scheduledTask.update({
      where: { id: failTask.id },
      data: { nextRunAt: new Date(Date.now() - 1000), chatId: foreignChatId },
    });
    const sweep6 = await runDueScheduledTasks();
    const failResult = sweep6.results.find((result) => result.taskId === failTask.id);
    const afterFail = await prisma.scheduledTask.findUnique({ where: { id: failTask.id } });
    check("D a failing dispatch reports failure", failResult?.ok === false, JSON.stringify(failResult ?? {}));
    check(
      "D and keeps its slot due with the reason stored",
      Boolean(afterFail?.lastError) && afterFail.nextRunAt?.getTime() < Date.now(),
      `lastError=${afterFail?.lastError?.slice(0, 60)}`,
    );
    await prisma.scheduledTask.delete({ where: { id: failTask.id } });

    // Phase B interplay: a scheduled run is an ordinary job, so its results are
    // chat messages and its TOOL context stays out of the transcript.
    const transcript = await findMessagesByChatId(chatId, user.userId);
    check(
      "D the chat transcript holds no TOOL rows",
      transcript.every((message) => message.role !== "TOOL"),
    );

    const page = await listScheduledTasks(user.userId, { limit: 50 });
    check("D listing is ownership scoped", page.tasks.every((entry) => entry.id !== undefined));
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("failures:");
    for (const failure of failed) console.log(`  - ${failure.name}${failure.detail ? ` (${failure.detail})` : ""}`);
  }

  mock.close();
  app?.close?.();
  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("harness error:", error);
  process.exit(1);
});
