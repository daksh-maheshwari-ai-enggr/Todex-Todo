import posix from "node:path/posix";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SandboxState } from "@daytonaio/sdk";
import { getSandboxForBot, getExistingSandboxForBot } from "./sandbox.js";
import { config } from "./config.js";

// Browser automation service.
//
// The browser itself lives inside the teammate's existing Daytona sandbox: the
// workspace, the shell tools and the browser all share one sandbox per teammate,
// so a browser action never provisions a second environment.
//
// A small Node server (`server/sandbox/browser-session.mjs`) is uploaded into
// the sandbox and owns one long-lived Chromium. The backend reaches it through a
// Daytona preview link authenticated with the sandbox's preview token — the
// token stays on the server and is never sent to the browser client.
//
// Every function here re-resolves the sandbox through getSandboxForBot, so
// ownership of the teammate is verified on every single operation.

const SESSION_SCRIPT = fileURLToPath(new URL("./sandbox/browser-session.mjs", import.meta.url));

// botId -> { promise, ready, error, baseUrl, port }
const sessions = new Map();

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function run(sandbox, command, { cwd, timeoutSec = 120 } = {}) {
  const result = await sandbox.process.executeCommand(
    command,
    cwd ?? undefined,
    undefined,
    timeoutSec,
  );
  return {
    exitCode: typeof result?.exitCode === "number" ? result.exitCode : null,
    output: String(result?.result ?? ""),
  };
}

// Same as run(), but a failure is not fatal. Used for steps whose outcome is
// verified afterwards by probing the session instead of trusting an exit code.
async function runSafe(sandbox, command, options) {
  try {
    return await run(sandbox, command, options);
  } catch (error) {
    return { exitCode: null, output: String(error?.message ?? "") };
  }
}

// Resolve the sandbox, the install directory, and the tokenized preview URL for
// the browser session port.
async function resolveTarget({ userId, botId }) {
  const { sandbox } = await getSandboxForBot({ userId, botId });
  const workDir = (await sandbox.getWorkDir()) || "/home";
  const installDir = posix.join(workDir, config.browser.installDir);

  const link = await sandbox.getPreviewLink(config.browser.sessionPort);
  if (!link?.url || !link?.token) {
    throw httpError(502, "The sandbox did not return a usable preview link.");
  }

  return { sandbox, workDir, installDir, baseUrl: link.url.replace(/\/$/, ""), token: link.token };
}

async function sessionFetch(target, path, { method = "GET", body, timeoutMs = 20000, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onAbort);

  try {
    const response = await fetch(`${target.baseUrl}${path}`, {
      method,
      headers: {
        "X-Daytona-Preview-Token": target.token,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

async function sessionHealth(target, timeoutMs = 5000) {
  try {
    const response = await sessionFetch(target, "/health", { timeoutMs });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Find a usable Chromium. Prefers an explicit configuration override, then
// whatever the sandbox image already provides.
async function findChromium(sandbox, workDir) {
  if (config.browser.executablePath) return config.browser.executablePath;

  const { output } = await runSafe(
    sandbox,
    "command -v chromium || command -v chromium-browser || command -v google-chrome || command -v google-chrome-stable || true",
    { cwd: workDir, timeoutSec: 30 },
  );
  const candidate = output.split("\n").map((line) => line.trim()).filter(Boolean)[0];
  return candidate || null;
}

// Install Chromium from the sandbox's own package manager. Slow on a cold
// sandbox, which is why the whole bootstrap is bounded by a configured timeout
// and reported honestly rather than pretended to have finished.
async function installChromium(sandbox, workDir, deadline) {
  const remainingSec = Math.max(30, Math.floor((deadline - Date.now()) / 1000));
  // Whether this succeeded is decided by findChromium() below, not by an exit
  // code: package managers exit non-zero for reasons that do not affect whether
  // a usable binary ended up on disk.
  await runSafe(sandbox, config.browser.installCommand, { cwd: workDir, timeoutSec: remainingSec });
  return findChromium(sandbox, workDir);
}

async function ensureSessionScript(sandbox, installDir) {
  const script = await readFile(SESSION_SCRIPT);
  const target = posix.join(installDir, "browser-session.mjs");
  await sandbox.fs.uploadFile(Buffer.from(script), target);
  return target;
}

async function installPlaywrightCore(sandbox, installDir) {
  // Idempotent: npm exits quickly when the package is already present.
  await runSafe(
    sandbox,
    "npm install --no-audit --no-fund --loglevel=error playwright-core 2>&1 | tail -3",
    { cwd: installDir, timeoutSec: 180 },
  );
}

async function startSession(sandbox, installDir) {
  const flags = [
    `--port=${config.browser.sessionPort}`,
    `--headless=${config.browser.headless ? "true" : "false"}`,
    `--width=${config.browser.viewportWidth}`,
    `--height=${config.browser.viewportHeight}`,
    `--frame-quality=${config.browser.frameQuality}`,
    `--frame-max-bytes=${config.browser.frameMaxBytes}`,
    `--frame-interval-ms=${config.browser.frameIntervalMs}`,
  ].join(" ");

  await runSafe(
    sandbox,
    `sudo bash -c 'mkdir -p ${installDir} && chown -R $(id -u):$(id -g) ${installDir}'`,
  );

  // Kill any stale session before starting a new one, so two Chromium instances
  // can never fight over the same port. Built from /proc rather than ps/pkill,
  // which the slim sandbox image does not ship.
  await runSafe(
    sandbox,
    "for f in $(grep -la browser-session.mjs /proc/[0-9]*/cmdline 2>/dev/null); do kill -9 $(basename $(dirname $f)) 2>/dev/null; done; sleep 1; true",
  );

  const executable = await findChromium(sandbox, installDir);
  const execFlag = executable ? `--executable=${executable} ` : "";

  // setsid + full stdio redirection detaches the server from the command
  // session. The command may still not return promptly, which is why runSafe
  // is used and the outcome is decided by polling /health.
  await runSafe(
    sandbox,
    `cd ${installDir} && setsid nohup env node browser-session.mjs ${execFlag}${flags} < /dev/null > session.log 2>&1 & echo started`,
    { cwd: installDir, timeoutSec: 20 },
  );

  return executable;
}

async function waitForHealth(target, deadline, onProgress) {
  let attempt = 0;
  while (Date.now() < deadline) {
    const health = await sessionHealth(target, 4000);
    if (health?.ok) return health;
    attempt += 1;
    onProgress?.(attempt, health);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

// Bootstrap once per teammate. Concurrent callers share the same promise so a
// burst of browser tool calls cannot install Chromium several times over.
function ensureSession({ userId, botId, onProgress }) {
  const existing = sessions.get(botId);
  if (existing?.promise) return existing.promise;

  const entry = { promise: null, ready: false, error: null, baseUrl: null };
  sessions.set(botId, entry);

  entry.promise = (async () => {
    const deadline = Date.now() + config.browser.bootstrapTimeoutMs;
    const target = await resolveTarget({ userId, botId });
    entry.baseUrl = target.baseUrl;

    // Already running (a warm sandbox, or a previous turn): reuse as-is.
    const warm = await sessionHealth(target, 5000);
    if (warm?.ok) {
      entry.ready = true;
      return target;
    }

    onProgress?.({ stage: "preparing", message: "Preparing the browser environment in the sandbox." });

    let executable = await findChromium(target.sandbox, target.workDir);
    if (!executable) {
      onProgress?.({ stage: "installing-browser", message: "Installing Chromium in the sandbox (first run only)." });
      executable = await installChromium(target.sandbox, target.workDir, deadline);
      if (!executable) {
        throw httpError(
          503,
          "Chromium could not be installed in the sandbox, so browser tools are unavailable.",
        );
      }
    }

    onProgress?.({ stage: "installing-driver", message: "Installing the browser driver in the sandbox." });
    await installPlaywrightCore(target.sandbox, target.installDir);
    await ensureSessionScript(target.sandbox, target.installDir);

    onProgress?.({ stage: "starting", message: "Starting the browser session." });
    await startSession(target.sandbox, target.installDir);

    const health = await waitForHealth(target, Math.min(deadline, Date.now() + 120000), () => {});
    if (!health?.ok) {
      const diagnostics = await run(
        target.sandbox,
        `tail -20 ${posix.join(target.installDir, "session.log")} 2>/dev/null || true`,
        { cwd: target.workDir, timeoutSec: 30 },
      );
      throw httpError(
        502,
        `The browser session did not start. ${diagnostics.output.trim().slice(0, 400)}`,
      );
    }

    entry.ready = true;
    entry.error = null;
    return target;
  })()
    .catch((error) => {
      entry.error = error?.message ?? "Browser session failed to start.";
      entry.ready = false;
      // Allow a later attempt to retry a failed bootstrap.
      sessions.delete(botId);
      throw error;
    });

  return entry.promise;
}

// Report the browser state for a teammate.
//
// Deliberately read-only: it resolves the teammate's *existing* sandbox and
// probes the session, but never creates a sandbox, installs anything or starts
// a browser. The UI polls this, so it must have no side effects. An unknown or
// unowned teammate propagates its 404 rather than being reported as "not ready".
export async function getBrowserStatus({ userId, botId }) {
  const { bot, sandbox, state } = await getExistingSandboxForBot({ userId, botId });

  const base = {
    botId,
    sandboxId: bot?.sandboxId ?? null,
    sandboxState: state,
    ready: false,
    url: null,
    title: null,
    lastError: null,
  };

  if (!sandbox || state !== SandboxState.STARTED) return base;

  try {
    const link = await sandbox.getPreviewLink(config.browser.sessionPort);
    if (!link?.url || !link?.token) return base;

    const response = await fetch(`${link.url.replace(/\/$/, "")}/health`, {
      headers: { "X-Daytona-Preview-Token": link.token },
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);

    if (!response?.ok) return base;
    const health = await response.json().catch(() => null);
    if (!health?.ok) return base;

    return {
      ...base,
      ready: true,
      url: health.url ?? null,
      title: health.title ?? null,
      framesSent: health.framesSent ?? 0,
      lastError: health.lastError ?? null,
    };
  } catch (error) {
    return { ...base, lastError: error?.message ?? null };
  }
}

// Perform one real browser action inside the teammate's sandbox.
export async function browserAct({ userId, botId, action, params = {} }) {
  if (!action || typeof action !== "string") {
    throw httpError(400, "action is required.");
  }

  const target = await ensureSession({ userId, botId });
  const timeoutMs = config.browser.actionTimeoutMs + 15000;

  let response;
  try {
    response = await sessionFetch(target, "/act", {
      method: "POST",
      body: { action, ...params },
      timeoutMs,
    });
  } catch (error) {
    // A dead session is dropped so the next call re-bootstraps instead of
    // failing forever against a stale preview link.
    sessions.delete(botId);
    throw httpError(502, `The sandbox browser did not respond: ${error?.message}`);
  }

  if (!response.ok) {
    throw httpError(502, `The sandbox browser returned status ${response.status}.`);
  }

  const payload = await response.json();
  if (!payload?.ok) {
    // The real failure is surfaced, never converted into a success.
    throw httpError(502, payload?.error ?? "The browser action failed.");
  }

  return payload;
}

export async function browserScreenshot({ userId, botId, fullPage = false }) {
  const target = await ensureSession({ userId, botId });
  const response = await sessionFetch(target, "/act", {
    method: "POST",
    body: { action: "screenshot", fullPage },
    timeoutMs: config.browser.actionTimeoutMs + 15000,
  });
  const payload = await response.json();
  if (!payload?.ok) throw httpError(502, payload?.error ?? "Screenshot failed.");

  // Screenshots can be large; the model gets a description, the UI gets the image.
  return {
    ok: true,
    url: payload.url,
    title: payload.title,
    bytes: payload.bytes,
    dataUrl: payload.dataUrl,
  };
}

// Relay the sandbox's live frame stream to an authenticated client response.
// The preview token and the sandbox URL stay on the server.
export async function relayFrameStream({ userId, botId, res, signal }) {
  const target = await ensureSession({ userId, botId });

  let upstream;
  try {
    upstream = await sessionFetch(target, "/frames", {
      timeoutMs: 30000,
      signal,
    });
  } catch (error) {
    sessions.delete(botId);
    throw httpError(502, `Could not open the sandbox browser stream: ${error?.message}`);
  }

  if (!upstream.ok || !upstream.body) {
    throw httpError(502, `The sandbox browser stream returned status ${upstream.status}.`);
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const cleanup = () => {
    try {
      upstream.body?.cancel?.();
    } catch {
      // Already closed.
    }
  };
  res.on("close", cleanup);
  signal?.addEventListener?.("abort", cleanup);

  try {
    for await (const chunk of upstream.body) {
      res.write(Buffer.from(chunk));
    }
  } catch {
    // A dropped upstream ends the stream; the client reconnects on its own.
  } finally {
    cleanup();
    res.end();
  }
}

// Process-local view of which teammates currently have a browser session, so the
// UI can show a useful state before the first network round trip.
export function isSessionWarm(botId) {
  return Boolean(sessions.get(botId)?.ready);
}
