import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { webSearch, searchProviderName, isSearchConfigured } from "../search.js";
import { config } from "../config.js";

// Web research tool. Kept separate from the browser tools on purpose: a search
// returns ranked results with excerpts, while the browser navigates and inspects
// pages. The model is told the difference so it does not report one as the other.

export const webSearchTool = tool(
  async (input) => {
    const result = await webSearch({
      query: input.query,
      numResults: input.numResults ?? config.search.maxResults,
    });

    return {
      ok: true,
      provider: result.provider,
      query: result.query,
      count: result.count,
      // Real titles, URLs and excerpts from the provider.
      results: result.results.map((row) => ({
        title: row.title,
        url: row.url,
        excerpt: row.excerpt,
        ...(row.publishedDate ? { publishedDate: row.publishedDate } : {}),
      })),
      note:
        "These are discovery results only. Open a page with browser_navigate and " +
        "inspect it with browser_read_page before drawing conclusions from it.",
    };
  },
  {
    name: "web_search",
    description:
      "Search the live web and get back ranked results with real titles, URLs and " +
      "text excerpts. Use this to discover which pages are worth opening; use the " +
      "browser tools to actually read a page. If search is not configured on the " +
      "server this tool returns an error and no results.",
    schema: z.object({
      query: z.string().min(1).max(500).describe("The research query."),
      numResults: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("How many results to return."),
    }),
  },
);

export function searchToolStatus() {
  return {
    configured: isSearchConfigured(),
    provider: searchProviderName(),
  };
}
