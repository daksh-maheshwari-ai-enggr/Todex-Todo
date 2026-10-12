import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { browserAct } from "../browser.js";
import { config } from "../config.js";

// Browser tools. Like the sandbox tools, they read trusted teammate context from
// the LangGraph runtime instead of from model-generated arguments, so the model
// can never choose whose sandbox browser it drives.
//
// Every tool returns what actually happened. When a page fails to load or a
// selector is missing, the real error text comes back to the model so it can
// retry or take a different route — it is never reported as success.

function getTrustedContext(runtime) {
  const configured = runtime?.config?.configurable ?? runtime?.configurable ?? {};
  const { userId, botId } = configured;

  if (!userId || !botId) {
    console.warn("[browser-tool] rejected call: missing trusted userId/botId in runtime config");
    throw new Error("Browser tools are not available in this context.");
  }

  return { userId, botId };
}

function summarizePage(result) {
  return {
    ok: true,
    action: result.action,
    url: result.url ?? null,
    title: result.title ?? null,
    ...(result.status !== undefined ? { status: result.status } : {}),
  };
}

export const browserNavigateTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    const result = await browserAct({
      userId,
      botId,
      action: "navigate",
      params: { url: input.url },
    });
    return summarizePage(result);
  },
  {
    name: "browser_navigate",
    description:
      "Open an absolute http(s) URL in the teammate's sandbox browser. Use this " +
      "before inspecting a page. Returns the final URL, the page title and the " +
      "HTTP status of the navigation.",
    schema: z.object({
      url: z.string().min(4).max(2048).describe("Absolute http(s) URL to open."),
    }),
  },
);

export const browserReadPageTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    const result = await browserAct({
      userId,
      botId,
      action: "content",
      params: { maxChars: input.maxChars ?? config.browser.maxContentChars },
    });
    return {
      ok: true,
      url: result.url ?? null,
      title: result.title ?? null,
      truncated: Boolean(result.truncated),
      chars: result.chars ?? null,
      text: result.text ?? "",
    };
  },
  {
    name: "browser_read_page",
    description:
      "Read the visible text of the page currently open in the sandbox browser. " +
      "Use this to inspect search results or article content and decide what to " +
      "open next. Text is truncated to a bounded length.",
    schema: z.object({
      maxChars: z
        .number()
        .int()
        .min(500)
        .max(60000)
        .optional()
        .describe("Maximum characters of page text to return."),
    }),
  },
);

export const browserGetLinksTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    const result = await browserAct({
      userId,
      botId,
      action: "links",
      params: { maxLinks: input.maxLinks ?? config.browser.maxLinks },
    });
    return {
      ok: true,
      url: result.url ?? null,
      title: result.title ?? null,
      count: result.count ?? (result.links?.length ?? 0),
      links: result.links ?? [],
    };
  },
  {
    name: "browser_get_links",
    description:
      "Extract the real hyperlinks (text plus absolute URL) from the page " +
      "currently open in the sandbox browser. Use this to collect citable URLs " +
      "after a navigation, for example from search results.",
    schema: z.object({
      maxLinks: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Maximum number of links to return."),
    }),
  },
);

export const browserClickTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    const result = await browserAct({
      userId,
      botId,
      action: "click",
      params: { selector: input.selector, text: input.text },
    });
    return summarizePage(result);
  },
  {
    name: "browser_click",
    description:
      "Click an element in the sandbox browser, by CSS selector or by its visible " +
      "text. If the element cannot be found the real error is returned.",
    schema: z.object({
      selector: z.string().max(1024).optional().describe("CSS selector to click."),
      text: z
        .string()
        .max(300)
        .optional()
        .describe("Visible text of the element to click, when a selector is unknown."),
    }),
  },
);

export const browserTypeTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    const result = await browserAct({
      userId,
      botId,
      action: "type",
      params: {
        selector: input.selector,
        text: input.text,
        submit: Boolean(input.submit),
      },
    });
    return summarizePage(result);
  },
  {
    name: "browser_type",
    description:
      "Type text into an input in the sandbox browser, optionally pressing Enter to " +
      "submit. Identifies the field by CSS selector, or falls back to the first " +
      "textbox on the page.",
    schema: z.object({
      selector: z.string().max(1024).optional().describe("CSS selector of the input."),
      text: z.string().min(1).max(2000).describe("Text to type."),
      submit: z
        .boolean()
        .optional()
        .describe("Press Enter after typing to submit the field."),
    }),
  },
);

export const browserPressTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    const result = await browserAct({
      userId,
      botId,
      action: "press",
      params: { key: input.key },
    });
    return summarizePage(result);
  },
  {
    name: "browser_press",
    description:
      "Send a single keyboard key to the sandbox browser, for example Enter, Tab, " +
      "Escape or ArrowDown.",
    schema: z.object({
      key: z
        .string()
        .min(1)
        .max(40)
        .describe("Keyboard key name, for example 'Enter' or 'PageDown'."),
    }),
  },
);

export const browserScrollTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    const result = await browserAct({
      userId,
      botId,
      action: "scroll",
      params: { deltaY: input.deltaY ?? config.browser.viewportHeight },
    });
    return { ok: true, scrolledBy: result.scrolledBy ?? null };
  },
  {
    name: "browser_scroll",
    description:
      "Scroll the sandbox browser viewport vertically. Positive values scroll down.",
    schema: z.object({
      deltaY: z
        .number()
        .int()
        .min(-20000)
        .max(20000)
        .optional()
        .describe("Pixels to scroll; positive scrolls down."),
    }),
  },
);

export const browserWaitForTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    const result = await browserAct({
      userId,
      botId,
      action: "wait_for",
      params: { selector: input.selector },
    });
    return { ok: true, found: result.found ?? input.selector };
  },
  {
    name: "browser_wait_for",
    description:
      "Wait until a CSS selector becomes visible in the sandbox browser. Use after " +
      "navigating to content that loads asynchronously.",
    schema: z.object({
      selector: z.string().min(1).max(1024).describe("CSS selector to wait for."),
    }),
  },
);

export const browserScreenshotTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    const result = await browserAct({
      userId,
      botId,
      action: "screenshot",
      params: { fullPage: Boolean(input.fullPage) },
    });
    // The model receives a description, not the image payload; the image itself
    // is what the live viewer shows.
    return {
      ok: true,
      url: result.url ?? null,
      title: result.title ?? null,
      bytes: result.bytes ?? null,
      note: "The screenshot is displayed in the app's live browser view.",
    };
  },
  {
    name: "browser_screenshot",
    description:
      "Capture the current viewport of the sandbox browser. The image is shown in " +
      "the app's live view; use it to confirm what is on screen.",
    schema: z.object({
      fullPage: z.boolean().optional().describe("Capture the full page instead of the viewport."),
    }),
  },
);

export const browserHistoryTool = tool(
  async (input, runtime) => {
    const { userId, botId } = getTrustedContext(runtime);
    const result = await browserAct({
      userId,
      botId,
      action: input.direction,
      params: {},
    });
    return summarizePage(result);
  },
  {
    name: "browser_history",
    description:
      "Move the sandbox browser through its own history: go back, go forward, or " +
      "reload the current page.",
    schema: z.object({
      direction: z.enum(["back", "forward", "reload"]).describe("Which history move to perform."),
    }),
  },
);

export const browserTools = [
  browserNavigateTool,
  browserReadPageTool,
  browserGetLinksTool,
  browserClickTool,
  browserTypeTool,
  browserPressTool,
  browserScrollTool,
  browserWaitForTool,
  browserScreenshotTool,
  browserHistoryTool,
];
