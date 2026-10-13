import "dotenv/config";

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function optional(name, defaultValue = null) {
  return process.env[name] || defaultValue;
}

// Trigger.dev is the durable execution layer for long-running teammate turns.
// It is optional: without a secret key the app still boots and every existing
// synchronous endpoint keeps working. Only the background job endpoints report
// "not configured".
const triggerSecretKey = optional("TRIGGER_SECRET_KEY", null);

export const config = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  port: Number(process.env.PORT) || 3000,
  openRouter: {
    apiKey: required("OPENROUTER_API_KEY"),
    model: optional("OPENROUTER_MODEL", "openai/gpt-3.5-turbo"),
    baseUrl: optional("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    timeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS) || 30000,
  },
  memory: {
    // Maximum number of recent messages loaded as agent context for a turn.
    maxHistoryMessages: Number(process.env.MEMORY_MAX_HISTORY_MESSAGES) || 30,
  },
  groupChats: {
    // Maximum number of teammate participants allowed per group chat.
    maxParticipants: Number(process.env.GROUP_CHAT_MAX_PARTICIPANTS) || 10,
  },
  handoffs: {
    // Safety limits applied across a whole handoff chain, not per teammate.
    maxDepth: Number(process.env.HANDOFF_MAX_DEPTH) || 3,
    maxExecutionsPerRequest: Number(process.env.HANDOFF_MAX_EXECUTIONS) || 6,
    timeoutMs: Number(process.env.HANDOFF_TIMEOUT_MS) || 60000,
    maxTaskLength: Number(process.env.HANDOFF_MAX_TASK_LENGTH) || 2000,
  },
  daytona: {
    // Credentials stay server-side. Optional so the app boots without Daytona.
    apiKey: optional("DAYTONA_API_KEY", null),
    apiUrl: optional("DAYTONA_API_URL", null),
    target: optional("DAYTONA_TARGET", null),
    language: optional("DAYTONA_SANDBOX_LANGUAGE", "python"),
    createTimeoutSec: Number(process.env.DAYTONA_CREATE_TIMEOUT_SEC) || 60,
    execTimeoutSec: Number(process.env.DAYTONA_EXEC_TIMEOUT_SEC) || 30,
    commandMaxLength: Number(process.env.DAYTONA_COMMAND_MAX_LENGTH) || 2000,
    pathMaxLength: Number(process.env.DAYTONA_PATH_MAX_LENGTH) || 1024,
    outputMaxBytes: Number(process.env.DAYTONA_OUTPUT_MAX_BYTES) || 8000,
    fileReadMaxBytes: Number(process.env.DAYTONA_FILE_READ_MAX_BYTES) || 50000,
    fileWriteMaxBytes: Number(process.env.DAYTONA_FILE_WRITE_MAX_BYTES) || 50000,
    listMaxEntries: Number(process.env.DAYTONA_LIST_MAX_ENTRIES) || 200,
    // Relative directory inside the sandbox work dir reserved for file tools.
    workspaceDir: optional("DAYTONA_WORKSPACE_DIR", "workspace"),
  },
  // Browser automation runs inside the teammate's sandbox. The backend reaches
  // the in-sandbox browser session through a Daytona preview link (the preview
  // token never leaves the server), so no sandbox port is ever exposed directly.
  browser: {
    // Port the in-sandbox browser session listens on.
    sessionPort: Number(process.env.BROWSER_SESSION_PORT) || 7331,
    // Where the session script, its node_modules and its logs live in the sandbox.
    installDir: optional("BROWSER_INSTALL_DIR", ".todex-browser"),
    // Chromium binary to drive. Empty means whatever the image provides.
    executablePath: optional("BROWSER_EXECUTABLE_PATH", null),
    // Command used to install Chromium into a sandbox that does not have it.
    // Overridable because a local registry mirror can make the default package
    // manager unusably slow; a baked snapshot removes the need entirely.
    installCommand: optional(
      "BROWSER_INSTALL_COMMAND",
      "sudo bash -c 'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends chromium' 2>&1 | tail -5",
    ),
    headless: process.env.BROWSER_HEADLESS !== "false",
    viewportWidth: Number(process.env.BROWSER_VIEWPORT_WIDTH) || 1280,
    viewportHeight: Number(process.env.BROWSER_VIEWPORT_HEIGHT) || 800,
    // Per-action ceiling for a single browser operation.
    actionTimeoutMs: Number(process.env.BROWSER_ACTION_TIMEOUT_MS) || 30000,
    // Page loads get their own, longer ceiling.
    navigationTimeoutMs: Number(process.env.BROWSER_NAV_TIMEOUT_MS) || 45000,
    // Bounding every piece of page text handed back to the model.
    maxContentChars: Number(process.env.BROWSER_MAX_CONTENT_CHARS) || 20000,
    maxLinks: Number(process.env.BROWSER_MAX_LINKS) || 60,
    // Screenshot/frame delivery. JPEG quality is only used for live frames.
    maxScreenshotBytes: Number(process.env.BROWSER_MAX_SCREENSHOT_BYTES) || 3000000,
    frameQuality: Number(process.env.BROWSER_FRAME_QUALITY) || 55,
    frameMaxBytes: Number(process.env.BROWSER_FRAME_MAX_BYTES) || 200000,
    frameIntervalMs: Number(process.env.BROWSER_FRAME_INTERVAL_MS) || 400,
    // How long to wait for a cold bootstrap (package install) before giving up.
    bootstrapTimeoutMs: Number(process.env.BROWSER_BOOTSTRAP_TIMEOUT_MS) || 900000,
  },
  // Human-in-the-loop approvals (ROADMAP.md Phase A). The agent pauses its tool
  // loop when an ApprovalRequest is PENDING for the chat and resumes when the
  // owner responds.
  approvals: {
    // How long a pending approval stays answerable before it expires.
    ttlMs: Number(process.env.APPROVAL_TTL_MS) || 24 * 60 * 60 * 1000,
    // Tool names that always require explicit approval before they run.
    // Comma-separated, empty by default: the ask_user tool plus the prompt's
    // "ask before irreversible actions" policy cover the rest. Enable e.g.
    // APPROVAL_GATED_TOOLS=sandbox_execute_command to hard-gate the shell.
    gatedTools: String(process.env.APPROVAL_GATED_TOOLS || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  },
  agent: {
    // Per-turn tool-call budgets. Chat turns stay tight for snappy replies;
    // background jobs get room for real multi-step tasks (bookings, research).
    maxToolCallsSync: Number(process.env.AGENT_MAX_TOOL_CALLS_SYNC) || 8,
    maxToolCallsJob: Number(process.env.AGENT_MAX_TOOL_CALLS_JOB) || 40,
  },
  search: {
    // Reusable web research provider. Deliberately optional: with no key the
    // search tool reports that it is not configured instead of pretending.
    provider: optional("SEARCH_PROVIDER", "exa"),
    exaApiKey: optional("EXA_API_KEY", null),
    maxResults: Number(process.env.SEARCH_MAX_RESULTS) || 5,
    timeoutMs: Number(process.env.SEARCH_TIMEOUT_MS) || 15000,
    maxExcerptChars: Number(process.env.SEARCH_MAX_EXCERPT_CHARS) || 1200,
  },
  triggerDev: {
    // Secrets stay server-side. Optional so the app boots without Trigger.dev.
    secretKey: triggerSecretKey,
    // Project ref is only needed by the Trigger.dev CLI/build, not by dispatch.
    projectRef: optional("TRIGGER_PROJECT_REF", null),
    // Bounds applied to every dispatched run, deliberately generous enough to
    // cover the whole handoff chain (handoffs.timeoutMs) with retries.
    maxAttempts: Number(process.env.TRIGGER_JOB_MAX_ATTEMPTS) || 3,
    maxDurationSec: Number(process.env.TRIGGER_JOB_MAX_DURATION_SEC) || 900,
    enabled: Boolean(triggerSecretKey),
  },
};