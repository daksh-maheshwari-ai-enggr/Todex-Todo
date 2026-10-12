import posix from "node:path/posix";
import { Daytona, SandboxState } from "@daytonaio/sdk";
import { prisma } from "./prisma.js";
import { config } from "./config.js";

// All Daytona SDK interaction lives in this module. Route handlers and tool
// definitions never talk to the provider directly, and every operation is
// scoped to a bot the authenticated user owns.

// In-process guard so concurrent requests for the same teammate do not each
// create a separate sandbox.
const creating = new Map();

let client = null;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertConfigured() {
  if (!config.daytona.apiKey) {
    throw httpError(503, "Sandbox provider is not configured.");
  }
}

function getClient() {
  assertConfigured();
  if (!client) {
    client = new Daytona({
      apiKey: config.daytona.apiKey,
      ...(config.daytona.apiUrl ? { apiUrl: config.daytona.apiUrl } : {}),
      ...(config.daytona.target ? { target: config.daytona.target } : {}),
    });
    // One line per process: shows which endpoint the SDK will actually call.
    // The key is never logged, only whether one is present.
    console.log(
      `[sandbox] daytona client configured (apiUrl=${config.daytona.apiUrl || "default"}, target=${config.daytona.target || "default"}, apiKey=set)`,
    );
  }
  return client;
}

// Resolve the acting teammate from trusted context and verify it belongs to the
// user. Model-supplied ids are never trusted on their own.
async function resolveOwnedBot(userId, botId) {
  if (!userId || typeof userId !== "string") {
    throw httpError(400, "Missing authenticated user context.");
  }
  if (!botId || typeof botId !== "string") {
    throw httpError(400, "Missing teammate context.");
  }

  const bot = await prisma.bot.findFirst({ where: { id: botId, userId } });
  if (!bot) {
    throw httpError(404, "Teammate not found or does not belong to the authenticated user.");
  }

  return bot;
}

async function persistSandboxId(botId, sandboxId) {
  try {
    await prisma.bot.update({ where: { id: botId }, data: { sandboxId } });
    console.log(`[sandbox] persisted sandboxId=${sandboxId ?? "null"} on bot ${botId}`);
  } catch (error) {
    // Never claim a sandbox was recorded when the write failed.
    console.warn(`[sandbox] failed to persist sandboxId on bot ${botId}:`, error?.message);
  }
}

// Create a sandbox and persist its id only after successful creation.
async function createSandboxForBot(bot) {
  if (creating.has(bot.id)) {
    return creating.get(bot.id);
  }

  const promise = (async () => {
    const daytona = getClient();
    console.log(`[sandbox] creating sandbox for bot ${bot.id} (language=${config.daytona.language})`);
    try {
      const sandbox = await daytona.create(
        {
          snapshot: "sandbox-slim",
          labels: { app: "todex-todo" },
        },
        { timeout: config.daytona.createTimeoutSec },
      );
      console.log(`[sandbox] created sandbox ${sandbox.id} for bot ${bot.id}, persisting id`);
      await persistSandboxId(bot.id, sandbox.id);
      return sandbox;
    } catch (error) {
      console.warn(`[sandbox] create failed for bot ${bot.id}:`, error?.message);
      throw error;
    }
  })().finally(() => creating.delete(bot.id));

  creating.set(bot.id, promise);
  return promise;
}

// Return a started sandbox for the teammate, reusing bot.sandboxId when it is
// usable and creating a fresh one when it is missing, stopped or unavailable.
export async function getSandboxForBot({ userId, botId }) {
  const bot = await resolveOwnedBot(userId, botId);
  const daytona = getClient();

  if (bot.sandboxId) {
    try {
      const sandbox = await daytona.get(bot.sandboxId);
      await sandbox.refreshData();
      console.log(`[sandbox] bot ${bot.id} has stored sandbox ${bot.sandboxId} in state ${sandbox.state}`);

      if (sandbox.state === SandboxState.STARTED) {
        return { bot, sandbox };
      }
      if (
        sandbox.state === SandboxState.STOPPED ||
        sandbox.state === SandboxState.ARCHIVED
      ) {
        await sandbox.start(config.daytona.createTimeoutSec);
        await sandbox.waitUntilStarted(config.daytona.createTimeoutSec);
        return { bot, sandbox };
      }
      // Any other state (error, destroyed, build_failed, ...) falls through to
      // a fresh sandbox below rather than reusing a broken one.
    } catch (error) {
      console.warn("Stored sandbox unavailable, creating a new one:", error?.message);
    }
  }

  const sandbox = await createSandboxForBot(bot);
  return { bot, sandbox };
}

// Read-only lookup of an existing sandbox. Unlike getSandboxForBot it never
// starts, repairs or creates anything, so endpoints the UI polls (browser
// status, previews) cannot provision infrastructure as a side effect.
export async function getExistingSandboxForBot({ userId, botId }) {
  const bot = await resolveOwnedBot(userId, botId);
  if (!bot.sandboxId) {
    return { bot, sandbox: null, state: "none" };
  }

  try {
    const daytona = getClient();
    const sandbox = await daytona.get(bot.sandboxId);
    await sandbox.refreshData();
    return { bot, sandbox, state: sandbox.state ?? "unknown" };
  } catch (error) {
    console.warn(`[sandbox] stored sandbox ${bot.sandboxId} is unavailable:`, error?.message);
    return { bot, sandbox: null, state: "unavailable" };
  }
}

// Report the current state of a teammate's sandbox without creating one.
export async function getSandboxStatus({ userId, botId }) {
  const bot = await resolveOwnedBot(userId, botId);
  if (!bot.sandboxId) {
    return { botId: bot.id, sandboxId: null, state: "none" };
  }

  try {
    const daytona = getClient();
    const sandbox = await daytona.get(bot.sandboxId);
    await sandbox.refreshData();
    return { botId: bot.id, sandboxId: sandbox.id, state: sandbox.state ?? "unknown" };
  } catch {
    return { botId: bot.id, sandboxId: bot.sandboxId, state: "unavailable" };
  }
}

async function getWorkspaceRoot(sandbox) {
  const workDir = (await sandbox.getWorkDir()) || "/home/daytona";
  return posix.join(workDir, config.daytona.workspaceDir);
}

// Normalize a model-supplied relative path and confine it to the workspace.
// Exported as a pure helper so the confinement rules can be verified directly.
export function resolveWorkspacePath(workspaceRoot, relativePath) {
  if (typeof relativePath !== "string") {
    throw httpError(400, "path must be a string.");
  }

  const trimmed = relativePath.trim();
  if (trimmed.length === 0) {
    throw httpError(400, "path must not be empty.");
  }
  if (trimmed.length > config.daytona.pathMaxLength) {
    throw httpError(400, "path exceeds the maximum length.");
  }
  if (trimmed.includes("\0")) {
    throw httpError(400, "path contains invalid characters.");
  }
  if (posix.isAbsolute(trimmed)) {
    throw httpError(400, "path must be relative to the workspace.");
  }

  const normalized = posix.normalize(trimmed);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw httpError(400, "path must not escape the workspace.");
  }

  const full = posix.join(workspaceRoot, normalized);
  if (full !== workspaceRoot && !full.startsWith(`${workspaceRoot}/`)) {
    throw httpError(400, "path must not escape the workspace.");
  }
  return full;
}

function toRelative(workspaceRoot, fullPath) {
  const relative = posix.relative(workspaceRoot, fullPath);
  return relative === "" ? "." : relative;
}

export async function listWorkspaceFiles({ userId, botId, path }) {
  const { sandbox } = await getSandboxForBot({ userId, botId });
  const root = await getWorkspaceRoot(sandbox);

  const target =
    path === undefined || path === null || path === ""
      ? root
      : resolveWorkspacePath(root, path);

  const files = await sandbox.fs.listFiles(target, { depth: 1 });
  const limited = files.slice(0, config.daytona.listMaxEntries);

  return {
    ok: true,
    path: toRelative(root, target),
    count: limited.length,
    truncated: files.length > limited.length,
    entries: limited.map((file) => ({
      name: file.name,
      path: file.path ? toRelative(root, file.path) : file.name,
      isDir: Boolean(file.isDir),
      size: file.size,
    })),
  };
}

export async function readWorkspaceFile({ userId, botId, path }) {
  const { sandbox } = await getSandboxForBot({ userId, botId });
  const root = await getWorkspaceRoot(sandbox);
  const full = resolveWorkspacePath(root, path);

  const details = await sandbox.fs.getFileDetails(full);
  if (details.isDir) {
    throw httpError(400, "path refers to a directory, not a file.");
  }
  if (details.size > config.daytona.fileReadMaxBytes) {
    throw httpError(
      413,
      `File exceeds the read limit of ${config.daytona.fileReadMaxBytes} bytes.`,
    );
  }

  const buffer = await sandbox.fs.downloadFile(full);
  const truncated = buffer.length > config.daytona.fileReadMaxBytes;
  const content = buffer.subarray(0, config.daytona.fileReadMaxBytes).toString("utf8");

  return {
    ok: true,
    path: toRelative(root, full),
    bytes: buffer.length,
    truncated,
    content,
  };
}

export async function writeWorkspaceFile({ userId, botId, path, content }) {
  if (typeof content !== "string") {
    throw httpError(400, "content must be a string.");
  }

  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > config.daytona.fileWriteMaxBytes) {
    throw httpError(
      413,
      `Content exceeds the write limit of ${config.daytona.fileWriteMaxBytes} bytes.`,
    );
  }

  const { sandbox } = await getSandboxForBot({ userId, botId });
  const root = await getWorkspaceRoot(sandbox);
  const full = resolveWorkspacePath(root, path);

  const parent = posix.dirname(full);
  if (parent !== root) {
    try {
      await sandbox.fs.createFolder(parent, "755");
    } catch {
      // Directory may already exist; upload will surface real failures.
    }
  }

  await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), full);

  return { ok: true, path: toRelative(root, full), bytes };
}

export async function executeWorkspaceCommand({ userId, botId, command, cwd }) {
  if (typeof command !== "string" || command.trim().length === 0) {
    throw httpError(400, "command must be a non-empty string.");
  }
  if (command.length > config.daytona.commandMaxLength) {
    throw httpError(400, "command exceeds the maximum length.");
  }

  const { sandbox } = await getSandboxForBot({ userId, botId });
  const root = await getWorkspaceRoot(sandbox);
  const workdir =
    cwd === undefined || cwd === null || cwd === ""
      ? root
      : resolveWorkspacePath(root, cwd);

  // Runs inside the isolated sandbox only. Never the host shell.
  const response = await sandbox.process.executeCommand(
    command,
    workdir,
    undefined,
    config.daytona.execTimeoutSec,
  );

  const output = typeof response?.result === "string" ? response.result : "";
  const truncated = output.length > config.daytona.outputMaxBytes;

  return {
    ok: true,
    exitCode: typeof response?.exitCode === "number" ? response.exitCode : null,
    truncated,
    output: truncated ? output.slice(0, config.daytona.outputMaxBytes) : output,
  };
}

// Explicit lifecycle operations. Not bound to any tool, so the model cannot
// stop or delete sandboxes; callers must invoke these deliberately.
export async function stopSandboxForBot({ userId, botId }) {
  const bot = await resolveOwnedBot(userId, botId);
  if (!bot.sandboxId) {
    return { stopped: false, sandboxId: null };
  }

  const daytona = getClient();
  const sandbox = await daytona.get(bot.sandboxId);
  await sandbox.stop();
  return { stopped: true, sandboxId: bot.sandboxId };
}

export async function deleteSandboxForBot({ userId, botId }) {
  const bot = await resolveOwnedBot(userId, botId);
  if (!bot.sandboxId) {
    return { deleted: false, sandboxId: null };
  }

  const daytona = getClient();
  const sandbox = await daytona.get(bot.sandboxId);
  await daytona.delete(sandbox);
  await persistSandboxId(bot.id, null);
  return { deleted: true, sandboxId: bot.sandboxId };
}
