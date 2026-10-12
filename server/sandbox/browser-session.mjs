// In-sandbox browser session.
//
// This file is uploaded into the teammate's sandbox and run there with Node. It
// owns a single, long-lived Chromium instance so that the agent's actions and
// the user's live view always operate on the *same* browser — a new page is
// never spawned per action.
//
// It is intentionally dependency-light: one npm package (playwright-core) and
// node's built-in http server.
//
// Endpoints (all reachable only through the sandbox's preview link, which the
// backend authenticates with the sandbox's preview token):
//   GET  /health          -> session state
//   POST /act             -> perform one real browser action, return its result
//   GET  /shot            -> current viewport as a PNG data URL
//   GET  /frames          -> Server-Sent Events stream of live JPEG frames
//
// Every failure is reported as { ok: false, error } with the real error message.
// Nothing here reports success for an action that did not happen.

import http from "node:http";
import { chromium } from "playwright-core";

// Configuration arrives as argv (--key=value). Environment variables are kept
// as a fallback, but argv is what detaching the process reliably preserves.
const argv = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const index = arg.indexOf("=");
      return [arg.slice(2, index), arg.slice(index + 1)];
    }),
);

function setting(name, fallback) {
  const envKey = `TODEX_BROWSER_${name.toUpperCase().replace(/-/g, "_")}`;
  const value = argv.get(name) ?? process.env[envKey];
  return value === undefined || value === "" ? fallback : value;
}

const PORT = Number(setting("port", 7331));
const EXECUTABLE_PATH = String(setting("executable", ""));
const HEADLESS = String(setting("headless", "true")) !== "false";
const VIEWPORT_WIDTH = Number(setting("width", 1280));
const VIEWPORT_HEIGHT = Number(setting("height", 800));
const FRAME_QUALITY = Number(setting("frame-quality", 55));
const FRAME_MAX_BYTES = Number(setting("frame-max-bytes", 200000));
const FRAME_INTERVAL_MS = Number(setting("frame-interval-ms", 400));
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_ACTION_TIMEOUT = 30000;
const DEFAULT_NAV_TIMEOUT = 45000;

let browser = null;
let context = null;
let page = null;
let cdp = null;
let launching = null;
let lastFrameAt = 0;
let framesSent = 0;
let lastError = null;

const frameSubscribers = new Set();

function log(...args) {
  console.log(`[browser-session]`, ...args);
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

// Publish one live frame to every viewer, throttled so a busy page cannot flood
// slow clients with data.
function publishFrame(base64Jpeg) {
  if (typeof base64Jpeg !== "string" || base64Jpeg.length === 0) return;
  if (base64Jpeg.length > FRAME_MAX_BYTES) return;

  const now = Date.now();
  if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
  lastFrameAt = now;
  framesSent += 1;

  const payload = `data: ${JSON.stringify({ jpeg: base64Jpeg, at: new Date().toISOString() })}\n\n`;
  for (const res of frameSubscribers) {
    try {
      res.write(payload);
    } catch {
      frameSubscribers.delete(res);
    }
  }
}

async function startScreencast() {
  if (!page || page.isClosed()) return;
  try {
    if (cdp) {
      try {
        await cdp.detach();
      } catch {
        // Already detached with the old page.
      }
    }
    cdp = await context.newCDPSession(page);
    cdp.on("Page.screencastFrame", async (frame) => {
      // Ack promptly: Chromium stops sending frames until the previous one is
      // acknowledged, so this is what keeps the view live.
      try {
        await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
      } catch {
        // The session went away; the next page event re-establishes it.
      }
      publishFrame(frame.data);
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: FRAME_QUALITY,
      maxWidth: VIEWPORT_WIDTH,
      maxHeight: VIEWPORT_HEIGHT,
      everyNthFrame: 1,
    });
    log("screencast started");
  } catch (error) {
    lastError = `screencast unavailable: ${error?.message}`;
    log(lastError);
  }
}

async function ensureBrowser() {
  if (browser?.isConnected?.() && page && !page.isClosed()) return;
  if (launching) {
    await launching;
    return;
  }

  launching = (async () => {
    log("launching chromium", EXECUTABLE_PATH || "(default)");
    browser = await chromium.launch({
      headless: HEADLESS,
      ...(EXECUTABLE_PATH ? { executablePath: EXECUTABLE_PATH } : {}),
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        // Explicitly off so it never blocks automation in a fresh profile.
        "--disable-features=Translate,MediaRouter",
      ],
    });

    context = await browser.newContext({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    });

    page = await context.newPage();
    page.setDefaultTimeout(DEFAULT_ACTION_TIMEOUT);
    page.setDefaultNavigationTimeout(DEFAULT_NAV_TIMEOUT);

    page.on("close", () => {
      log("page closed");
    });
    page.on("crash", () => {
      lastError = "page crashed";
      log(lastError);
    });

    await page.goto("about:blank", { waitUntil: "domcontentloaded" }).catch(() => {});
    await startScreencast();
    lastError = null;
  })();

  try {
    await launching;
  } finally {
    launching = null;
  }
}

async function pageSummary() {
  if (!page || page.isClosed()) return { url: null, title: null };
  return { url: page.url(), title: await page.title().catch(() => null) };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// Perform one action against the real page. Returns a JSON-serializable result;
// failures carry the real error text so the agent can react instead of guessing.
async function performAction(input) {
  await ensureBrowser();

  const action = String(input?.action ?? "").trim();
  const timeoutMs =
    action === "navigate"
      ? Number(input?.timeoutMs) || DEFAULT_NAV_TIMEOUT
      : Number(input?.timeoutMs) || DEFAULT_ACTION_TIMEOUT;

  const run = async () => {
    switch (action) {
      case "navigate": {
        const url = String(input?.url ?? "").trim();
        if (!/^https?:\/\//i.test(url)) {
          throw new Error("url must be an absolute http(s) URL");
        }
        const response = await page.goto(url, {
          waitUntil: input?.waitUntil ?? "domcontentloaded",
          timeout: timeoutMs,
        });
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        const summary = await pageSummary();
        return {
          ok: true,
          action,
          url: summary.url,
          title: summary.title,
          status: response?.status() ?? null,
        };
      }

      case "click": {
        const selector = typeof input?.selector === "string" ? input.selector : null;
        const text = typeof input?.text === "string" ? input.text : null;
        if (!selector && !text) throw new Error("click requires selector or text");

        const locator = selector
          ? page.locator(selector).first()
          : page.getByText(text, { exact: false }).first();

        await locator.waitFor({ state: "visible", timeout: timeoutMs });
        await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs }).catch(() => {});
        await locator.click({ timeout: timeoutMs });
        await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
        const summary = await pageSummary();
        return { ok: true, action, url: summary.url, title: summary.title };
      }

      case "type": {
        const selector = typeof input?.selector === "string" ? input.selector : null;
        const text = String(input?.text ?? "");
        const locator = selector
          ? page.locator(selector).first()
          : page.getByRole("textbox").first();

        await locator.waitFor({ state: "visible", timeout: timeoutMs });
        if (input?.clear !== false) await locator.fill("", { timeout: timeoutMs }).catch(() => {});
        await locator.type(text, { delay: 15, timeout: timeoutMs });

        if (input?.submit) {
          await locator.press("Enter", { timeout: timeoutMs });
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        }
        const summary = await pageSummary();
        return { ok: true, action, url: summary.url, title: summary.title, typed: text.length };
      }

      case "press": {
        const key = String(input?.key ?? "Enter");
        await page.keyboard.press(key);
        await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
        const summary = await pageSummary();
        return { ok: true, action, url: summary.url, title: summary.title };
      }

      case "scroll": {
        const deltaY = Number(input?.deltaY) || VIEWPORT_HEIGHT;
        await page.mouse.wheel(0, deltaY);
        await page.waitForTimeout(400);
        return { ok: true, action, scrolledBy: deltaY };
      }

      case "hover": {
        const selector = String(input?.selector ?? "");
        if (!selector) throw new Error("hover requires selector");
        await page.locator(selector).first().hover({ timeout: timeoutMs });
        return { ok: true, action };
      }

      case "wait_for": {
        const selector = String(input?.selector ?? "");
        if (!selector) throw new Error("wait_for requires selector");
        await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
        return { ok: true, action, found: selector };
      }

      case "back": {
        await page.goBack({ waitUntil: "domcontentloaded", timeout: timeoutMs });
        const summary = await pageSummary();
        return { ok: true, action, url: summary.url, title: summary.title };
      }

      case "forward": {
        await page.goForward({ waitUntil: "domcontentloaded", timeout: timeoutMs });
        const summary = await pageSummary();
        return { ok: true, action, url: summary.url, title: summary.title };
      }

      case "reload": {
        await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
        const summary = await pageSummary();
        return { ok: true, action, url: summary.url, title: summary.title };
      }

      case "content": {
        const maxChars = Number(input?.maxChars) || 20000;
        const text = await withTimeout(
          page.evaluate(() => (document.body ? document.body.innerText : "")),
          timeoutMs,
          "content",
        );
        const clean = String(text ?? "").replace(/\n{3,}/g, "\n\n").trim();
        const summary = await pageSummary();
        return {
          ok: true,
          action,
          url: summary.url,
          title: summary.title,
          truncated: clean.length > maxChars,
          text: clean.slice(0, maxChars),
          chars: clean.length,
        };
      }

      case "links": {
        const maxLinks = Number(input?.maxLinks) || 60;
        const links = await withTimeout(
          page.evaluate(() =>
            Array.from(document.querySelectorAll("a[href]")).map((a) => ({
              text: (a.innerText || a.textContent || "").replace(/\s+/g, " ").trim(),
              href: a.href,
            })),
          ),
          timeoutMs,
          "links",
        );

        const seen = new Set();
        const unique = [];
        for (const link of links ?? []) {
          if (!link?.href || !/^https?:\/\//i.test(link.href)) continue;
          if (seen.has(link.href)) continue;
          seen.add(link.href);
          unique.push({ text: link.text.slice(0, 200), href: link.href });
          if (unique.length >= maxLinks) break;
        }
        const summary = await pageSummary();
        return {
          ok: true,
          action,
          url: summary.url,
          title: summary.title,
          count: unique.length,
          links: unique,
        };
      }

      case "screenshot": {
        const buffer = await page.screenshot({
          type: "png",
          fullPage: Boolean(input?.fullPage),
          timeout: timeoutMs,
        });
        const summary = await pageSummary();
        return {
          ok: true,
          action,
          url: summary.url,
          title: summary.title,
          bytes: buffer.length,
          dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
        };
      }

      case "eval": {
        // Read-only page inspection: returns a JSON value from the page.
        const script = String(input?.script ?? "");
        if (!script) throw new Error("eval requires script");
        const value = await withTimeout(page.evaluate(script), timeoutMs, "eval");
        return { ok: true, action, value: JSON.parse(JSON.stringify(value ?? null)) };
      }

      default:
        throw new Error(`unsupported action: ${action || "(empty)"}`);
    }
  };

  try {
    return await run();
  } catch (error) {
    lastError = `${action}: ${error?.message}`;
    log("action failed:", lastError);
    return {
      ok: false,
      action,
      error: String(error?.message ?? error).slice(0, 1000),
    };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const summary = page && !page.isClosed() ? await pageSummary() : { url: null, title: null };
      return sendJson(res, 200, {
        ok: true,
        pid: process.pid,
        connected: Boolean(browser?.isConnected?.()),
        headless: HEADLESS,
        executablePath: EXECUTABLE_PATH || null,
        framesSent,
        viewers: frameSubscribers.size,
        url: summary.url,
        title: summary.title,
        lastError,
      });
    }

    if (req.method === "GET" && url.pathname === "/frames") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 2000\n\n");

      frameSubscribers.add(res);
      await ensureBrowser();

      // Send one immediate frame so the viewer is not blank while waiting for
      // the next page change.
      try {
        const buffer = await page.screenshot({ type: "jpeg", quality: FRAME_QUALITY });
        const payload = `data: ${JSON.stringify({ jpeg: buffer.toString("base64"), at: new Date().toISOString() })}\n\n`;
        res.write(payload);
      } catch {
        // The next real frame will arrive from the screencast.
      }

      const heartbeat = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          // cleaned up on close below
        }
      }, 15000);

      const cleanup = () => {
        clearInterval(heartbeat);
        frameSubscribers.delete(res);
      };
      req.on("close", cleanup);
      req.on("aborted", cleanup);
      return undefined;
    }

    if (req.method === "GET" && url.pathname === "/shot") {
      await ensureBrowser();
      const buffer = await page.screenshot({ type: "png" });
      return sendJson(res, 200, {
        ok: true,
        bytes: buffer.length,
        dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
      });
    }

    if (req.method === "POST" && url.pathname === "/act") {
      const body = await readBody(req);
      const result = await performAction(body);
      return sendJson(res, result.ok ? 200 : 200, result);
    }

    if (req.method === "POST" && url.pathname === "/shutdown") {
      sendJson(res, 200, { ok: true, stopping: true });
      setTimeout(() => process.exit(0), 100);
      return undefined;
    }

    return sendJson(res, 404, { ok: false, error: `unknown route ${url.pathname}` });
  } catch (error) {
    log("request failed:", error?.message);
    return sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  log(`listening on ${PORT}`);
});

// Bring the browser up eagerly so the first action is not slowed by a cold start.
ensureBrowser().catch((error) => log("initial launch failed:", error?.message));

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    log(`received ${signal}, shutting down`);
    browser?.close?.().catch(() => {});
    process.exit(0);
  });
}
