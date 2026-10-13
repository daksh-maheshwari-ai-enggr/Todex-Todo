# ROADMAP — From Todex-todo to an Operator-style Autonomous Agent

Status: **spec only — no code yet.** Each phase is independently shippable and
verifiable. File paths reference the codebase as it exists today.

---

## 0. Why it doesn't behave like Operator / dots / muse today

| Building block | Todex-todo today | Needed |
|---|---|---|
| Agent turn | One synchronous LangGraph run (`server/agent.js` → `chatTurn.js`), no way to pause | Pause mid-run, persist state, resume after human input |
| Human input | Only a new chat message that starts a *new* turn | Answer injected into the *same* run as a tool result |
| Tool budget | `MAX_TOOL_CALLS = 8`, one process, one timeout | 30–100+ step runs that survive restarts |
| Tool results | Recorded in `ToolExecution`, not fed back after restart | Persisted so a resumed run sees its own prior work |
| Job lifecycle | `AiJob`: QUEUED → RUNNING → terminal | Add `WAITING_FOR_USER` as a first-class state |
| User vs browser | User watches frames (`sandboxView.js`) but can't interact | Takeover: user drives the same browser, hands it back |
| Initiation | Human always sends the first message | Scheduled/proactive runs ("join Meet at 3pm") |
| External actions | Browser-only | Approved messaging/calendar integrations |

Everything below hangs off **one spine: pause → persist → human answers → resume.**
Build that first; booking, Meet-attending and messaging are features layered on it.

---

## 1. Target experience (acceptance demos)

1. **"Book me a train ticket from Berlin to Hamburg on Friday"**
   → agent browses, compares options, *stops* and asks "2nd class, 09:40 departure — confirm purchase?"
   → user taps Approve → same run continues → reports confirmation.
2. **Site needs login/OTP**
   → agent raises an approval, user takes over the sandbox browser, logs in, hands back,
   → agent continues with the session cookies already in place.
3. **"Attend my 3pm Google Meet and message Priya the summary"**
   → scheduled run joins the meeting in the sandbox browser, takes notes,
   → posts the summary to the chat, asks before sending anything externally.

---

## 2. Core architectural decisions

**D1 — Pause/resume is implemented in Prisma, not a LangGraph Postgres checkpointer.**
AGENTS.md mandates Prisma for all DB access; a raw `pg` pool for
`@langchain/langgraph-checkpoint-postgres` would violate it. The agent already
rebuilds its message list from the DB each turn, so we extend that pattern:

- On pause: store the pending tool call(s) on an `ApprovalRequest` row and stop the graph.
- On resume: rebuild `SystemMessage + history + synthetic AIMessage(tool_calls=[...]) + ToolMessage(answer)` and re-invoke the graph.

**D2 — Extend `AiJob`, don't add a parallel Task table.**
`AiJob` already has ownership, idempotency, run reconciliation and Trigger.dev
wiring. A "task" in the Operator sense is a job that can enter
`WAITING_FOR_USER` and be resumed. Duplicate models would double every service
(AGENTS §4: reuse, no duplicate implementations). A separate `ScheduledTask`
table appears only in Phase D because scheduled work is genuinely a different
lifecycle.

**D3 — Logins use takeover, not a credential vault.**
The user drives the real browser in the sandbox (Operator's model). No site
passwords ever touch our database. A vault remains a later, optional decision.

**D4 — All long agent runs go through Trigger.dev; the sync respond path stays for chat.**
Pause/resume must work identically wherever the run started, so both paths call
the same `resumeRun()` service.

---

## 3. Phase A — Human-in-the-loop (ask → approve → resume) ⭐ the spine

> **Status: implemented and verified** (2026-10-12). Schema + migration
> `20261012000000_add_approvals` applied; `ask_user` tool, ACTION gate, pause
> routing and resume rebuild live in `server/agent.js`; approvals service/API in
> `server/approvals.js` + `server/routes/approvals.js`; UI card in
> `client/src/components/chat/ApprovalCard.jsx`. Verified end-to-end against the
> running server (QUESTION pause/resume, ACTION gate + reject, background-job
> WAITING_FOR_USER + inline resume) with a mock LLM at the provider boundary,
> because the OpenRouter free tier was rate-limited (429) at the time.
> Deviations from this spec: the browser password-field probe is deferred to
> Phase C (the gate currently works off `APPROVAL_GATED_TOOLS`, default empty —
> ask_user + prompt policy carry the everyday flow).

**Goal:** the agent can stop at any point, ask you anything, and continue the
*same* run with your answer. This alone makes the product feel like Operator.

### A1 — `ask_user` tool + pause/resume

**Schema (`prisma/schema.prisma`)** — plus relations on `User`, `Chat`, `Bot`, `AiJob`:

```prisma
enum ApprovalKind   { QUESTION  ACTION }
enum ApprovalStatus { PENDING  APPROVED  REJECTED  EXPIRED  CANCELLED }

model ApprovalRequest {
  id        String  @id @default(cuid())
  userId    String
  chatId    String
  botId     String?
  aiJobId   String?              // paused run (null for sync respond turns)
  kind      ApprovalKind
  question  String  @db.VarChar(2000)   // what the user sees
  options   String? @db.VarChar(2000)   // quick-reply choices, newline separated
  // ACTION approvals: the deferred tool call
  toolName  String? @db.VarChar(100)
  toolCallId String? @db.VarChar(200)
  args      String? @db.VarChar(4000)
  // Display/repair links
  assistantMessageId String?     // the question message in the chat
  responseMessageId  String?     // the user's answer message (excluded from resume context)
  status    ApprovalStatus @default(PENDING)
  response  String? @db.VarChar(4000)   // answer or rejection reason
  createdAt DateTime @default(now())
  resolvedAt DateTime?
  expiresAt DateTime?

  @@index([userId, status])
  @@index([chatId, status])
}
```

```prisma
enum AiJobStatus { QUEUED  RUNNING  WAITING_FOR_USER  SUCCEEDED  FAILED  CANCELLED }
// AiJob += stepCount Int, lastApprovalId String?, waitSince DateTime?
// jobs.js: ACTIVE_STATUSES += WAITING_FOR_USER, CANCELLABLE_STATUSES += WAITING_FOR_USER
// resolveAppStatus: a terminal Trigger "COMPLETED" must NOT flip a WAITING job to SUCCEEDED
```

**New files**

| File | Responsibility |
|---|---|
| `server/approvals.js` | createApproval / listPending / respondApproval — ownership on every op |
| `server/tools/askUser.js` | `ask_user({ question, options? })` → creates a PENDING QUESTION approval from trusted runtime context |
| `server/routes/approvals.js` | `GET /api/approvals?chatId=` · `POST /api/approvals/:id/respond` `{ answer }` or `{ approved, note }` |
| `client/src/services/approvalService.js` | API calls |
| `client/src/components/chat/ApprovalCard.jsx` | Question + option buttons + free text / Approve + Reject |

**Modified files**

- `server/tools/registry.js` — register `ask_user`.
- `server/agent.js`
  - `toolsExecutionNode`: after each tool round, if a PENDING approval exists → route graph to `END` (new conditional edge after `tools`), exposing `pendingApprovalId`.
  - New export `resumeRun({ approval, answer, approved })`: rebuilds messages
    (history **minus** `responseMessageId` and the stored question message) +
    synthetic `AIMessage(tool_calls=[stored call])` + `ToolMessage(answer or rejection)` → re-invoke.
    - QUESTION → resume into `model` node.
    - ACTION approved → resume into `tools` node with that `toolCallId` gate-bypassed.
    - ACTION rejected → resume into `model` with a ToolMessage `"User rejected: <reason>"`.
  - Raise `MAX_TOOL_CALLS` into `config` (8 sync / 40 job) — real booking flows don't fit in 8.
- `server/chatTurn.js` — if generation ended paused: persist the question as an
  assistant `Message` (linked via `assistantMessageId`), emit
  `activityApprovalPending`, return `{ pendingApproval }` instead of a reply.
- `server/jobRunner.js` / `trigger/ai-job.js` — a paused turn completes the
  Trigger run *without* marking the job terminal; job status = `WAITING_FOR_USER`.
- `server/routes/approvals.js` respond → resolve approval → resume:
  job-backed runs re-dispatch via `tasks.trigger(..., { idempotencyKey: "resume:"+approvalId })`;
  sync turns resume inline.
- `server/activity.js` — `approvalPending` / `approvalResolved` events on the existing SSE stream.
- `server/config.js` — approval expiry, per-run tool budget.
- `server/index.js` — mount `/api/approvals`.
- `ChatPage.jsx` — render `ApprovalCard` for pending approvals (fetched with messages); submitting an answer continues the turn over the existing SSE channel.

### A2 — Hard gate for sensitive actions

- Gated tool set in `config` (start with: any `browser_type`/`browser_click`
  whose page contains `input[type=password]` — `browser-session.mjs` gains a
  `requiresSecret` probe — plus every future send/book/pay tool).
- Gated call detected **before** execution → create ACTION approval carrying
  `toolName/args/toolCallId`, skip execution, pause (same flow as A1).
- `ApprovalCard` for ACTION shows the concrete action ("Type **** into
  booking-form password", "Click 'Pay €49'") with Approve / Reject / Take over.

### Phase A acceptance

- [ ] Agent pauses mid-run with a question; card appears over SSE; job shows `WAITING_FOR_USER`.
- [ ] Answer resumes **the same run** — `ToolExecution` log proves the original task continued (not a fresh turn).
- [ ] Reject → agent adapts and continues ("user declined, showing alternatives").
- [ ] Server restart while waiting → approval survives; respond still resumes.
- [ ] Cross-user access to an approval → 404. Duplicate respond → 409.
- [ ] Sensitive browser action is blocked until approved; approval bypass is single-use (`toolCallId` scoped).

---

## 4. Phase B — Long-horizon durable runs

**Goal:** 30–100+ step tasks that survive restarts and crashes.

1. **Persist tool results for context.** `MessageRole.TOOL` already exists.
   In `toolsExecutionNode` (alongside the existing `ToolExecution` write), store
   bounded TOOL messages; extend `memory.js::loadConversationContext` and
   `agent.js::historyToMessages` to include them — synthesizing an
   `AIMessage(tool_calls=[...])` (ids from `ToolExecution.toolCallId`) before
   each consecutive tool-message group so providers accept the ordering.
2. **Step accounting.** `AiJob.stepCount` incremented per tool round;
   budget + wall-clock deadline (`config.job.maxSteps`, `maxDurationMs`) in
   `agent.js`. Hitting the cap → `finalizeNode` (already exists) with an honest
   "stopped after N steps" summary.
3. **Crash-safe resume.** `jobRunner.runAiJob` already re-reads all context from
   the DB per attempt — with tool messages persisted, a retry/re-dispatch
   continues instead of restarting. Reuse the Phase A resume dispatch path.
4. **Observability.** `routes/jobs.js` exposes the step list (from
   `ToolExecution` + approvals); `BackgroundJobsPage.jsx` shows a step timeline
   and a prominent `⏸ Waiting for you` state with a link to the approval.

**Files:** `prisma/schema.prisma`, `server/agent.js`, `server/memory.js`,
`server/jobs.js`, `server/jobRunner.js`, `trigger/ai-job.js`,
`client/src/pages/BackgroundJobsPage.jsx`, `server/activity.js`.

### Phase B acceptance

- [ ] A scripted 40+ step browsing task completes end-to-end.
- [ ] Kill the API server mid-run → job resumes without duplicating user messages and without losing completed tool work.
- [ ] `WAITING_FOR_USER` is never flipped to SUCCEEDED/FAILED by run reconciliation or retries.
- [ ] Budget exhaustion ends with a truthful summary, not an error loop.

---

## 5. Phase C — Browser takeover

**Goal:** when the agent stalls on login/OTP/CAPTCHA/payment, you operate the
*same* sandbox browser, then hand control back.

- `server/sandbox/browser-session.mjs` — control mode `agent | user`;
  `POST /input` relays mouse (`page.mouse.*`) / keyboard (`page.keyboard.*`)
  events with viewport coordinates; frames keep streaming either way.
- `server/browser.js` — `takeBrowserControl` / `releaseBrowserControl` /
  `relayUserInput`; while `user` mode is active, agent `browser_*` tools return
  a truthful error ("user has control") instead of silently acting.
- `server/routes/sandboxView.js` — `POST /:botId/desktop/control`, `POST /:botId/desktop/input` (ownership enforced).
- `client/src/components/sandbox/BrowserPane.jsx` — interactive overlay
  (click/scroll/type forwarding, coordinate mapping) + "Take control" / "Hand back".
- `ApprovalCard` — "Take over browser" resolves into takeover mode; on hand-back,
  prompt: *"What should the agent know?"* → that text becomes the approval answer.

### Phase C acceptance

- [ ] Hit a login wall → take over → log in → hand back → agent continues in the same session (cookies persist).
- [ ] Agent browser tools never fight the user for control.
- [ ] Takeover requires a PENDING approval (no drive-by control), scoped to the owning user.

---

## 6. Phase D — Scheduling & proactive tasks

**Goal:** "attend the 3pm Meet", "message Priya at 5".

- New model `ScheduledTask { id, userId, botId, chatId?, goal, runAt?, cron?,
  timezone, status, lastRunAt, nextRunAt }` (different lifecycle: repeated/deferred).
- `server/scheduledTasks.js` (CRUD + ownership) + `server/routes/scheduledTasks.js`.
- `trigger/scheduled-task.js` — cron sweep → due tasks → dispatch the existing
  `AI_JOB_TASK_ID` with the goal as the message (reuses Phase A/B machinery,
  including pause-for-approval).
- Results/asks land in the linked chat (`Message` + existing activity SSE) —
  in-app notification first; email push later.
- Meet demo: open the Meet URL in the sandbox browser, join with mic/camera off,
  screenshot notes on an interval, post a summary. **Honest limitation:** real
  camera/mic participation is out of scope for headless v1.
- UI: extend `BackgroundJobsPage.jsx` (or a tab) with scheduled tasks.

### Phase D acceptance

- [ ] A task scheduled +2 minutes runs unattended, posts its result to the chat.
- [ ] A scheduled task that needs input pauses with an approval exactly like a chat-run.
- [ ] Deleted/foreign `ScheduledTask` → 404; orphan runs cancelled.

---

## 7. Phase E — External actions (messaging)

**Goal:** "send the message to this person" for real.

- New registry tools (`server/tools/gmail.js` / slack / etc.), declared **sensitive**
  so every send pauses for approval (Phase A2 gate).
- OAuth flow per provider (store refresh tokens encrypted; provider secrets stay
  backend-only), `Credential` relation owned by `User`.
- **Open decision:** which channel first — Gmail, Slack, WhatsApp, or Telegram
  (see §8). Picked via a service search before any code.

### Phase E acceptance

- [ ] Agent drafts a message from chat context → approval card shows full text → approve → sent → proof recorded in the chat.
- [ ] Reject/cancel before send → nothing leaves the system.
- [ ] Tokens never appear in logs, activity stream, or model context.

---

## 8. Open decisions (needed before the phase they affect)

| # | Decision | Resolution | Status |
|---|---|---|---|
| 1 | Messaging channel for Phase E | **Gmail** (Gmail API, OAuth, every send gated by Phase A2 approval) | ✅ decided |
| 2 | Login strategy | **Browser takeover** (D3); no credential vault | ✅ decided |
| 3 | AGENTS.md sequence | **Phases A–E appended** to the planned sequence in AGENTS.md | ✅ decided |

## 9. Explicit non-goals (per AGENTS.md)

No microservices · no new databases or ORMs · no Next/Clerk/Drizzle · Daytona
and Trigger.dev stay infrastructure layers behind `sandbox.js` / `backgroundJobs.js` ·
no AI-generated commands on the host · no credential exposure to model or frontend.

## 10. Build order & why

```
A (pause/resume) → B (durability) → C (takeover) → D (scheduling) → E (messaging)
```

A is the spine: B makes pauses survive restarts, C removes the login blocker,
D gives the agent its own clock, E is the first irreversible external action
that leans on all four. Each phase ends with its acceptance checklist run
manually end-to-end before the next begins.
