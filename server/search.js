import { config } from "./config.js";

// Web research service.
//
// One provider is implemented (Exa) behind a small, explicit abstraction so a
// different provider can be added without touching the agent or the tool
// registry. Credentials are read from the environment only and are never logged
// or returned to the client.
//
// When no credential is configured, every entry point reports "not configured"
// rather than returning invented results — the agent is then told the search was
// unavailable and must not claim it searched.

const PROVIDERS = ["exa"];

function serviceError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function searchProviderName() {
  return config.search.provider;
}

export function isSearchConfigured() {
  if (config.search.provider === "exa") return Boolean(config.search.exaApiKey);
  return false;
}

export function describeSearchAvailability() {
  if (!PROVIDERS.includes(config.search.provider)) {
    return `Unsupported search provider "${config.search.provider}". Supported providers: ${PROVIDERS.join(", ")}.`;
  }
  if (!isSearchConfigured()) {
    return "Web search is not configured. Set EXA_API_KEY (and optionally SEARCH_PROVIDER=exa) on the server to enable it.";
  }
  return null;
}

function bound(value, max) {
  const text = typeof value === "string" ? value : "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function exaSearch({ query, numResults, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.search.timeoutMs);
  signal?.addEventListener?.("abort", () => controller.abort());

  let response;
  try {
    response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        // The key is only ever sent to the provider, never logged.
        "x-api-key": config.search.exaApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        numResults,
        type: "auto",
        contents: { text: { maxCharacters: config.search.maxExcerptChars } },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw serviceError(504, "The search provider did not respond in time.");
    }
    throw serviceError(502, `Could not reach the search provider: ${error?.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Bounded provider message, no request headers, no key.
    const detail = bound(await response.text().catch(() => ""), 300);
    throw serviceError(
      response.status === 401 || response.status === 403 ? 502 : 502,
      `The search provider rejected the request (status ${response.status}). ${detail}`,
    );
  }

  const payload = await response.json().catch(() => null);
  const rows = Array.isArray(payload?.results) ? payload.results : null;
  if (!rows) {
    throw serviceError(502, "The search provider returned an unexpected response shape.");
  }

  return rows.map((row) => ({
    title: bound(row?.title ?? "", 300),
    url: typeof row?.url === "string" ? row.url : "",
    excerpt: bound(row?.text ?? row?.summary ?? "", config.search.maxExcerptChars),
    publishedDate: row?.publishedDate ?? null,
    author: row?.author ?? null,
  }));
}

// Run a real web search. Returns actual titles, URLs and excerpts from the
// provider, or throws with the real reason it could not.
export async function webSearch({ query, numResults, signal }) {
  if (typeof query !== "string" || query.trim().length === 0) {
    throw serviceError(400, "query is required and must be a non-empty string.");
  }
  if (query.length > 500) {
    throw serviceError(400, "query exceeds the maximum length of 500 characters.");
  }

  const availability = describeSearchAvailability();
  if (availability) throw serviceError(503, availability);

  const limit = Math.min(Math.max(Number(numResults) || config.search.maxResults, 1), 20);

  let results;
  if (config.search.provider === "exa") {
    results = await exaSearch({ query: query.trim(), numResults: limit, signal });
  } else {
    throw serviceError(503, `Unsupported search provider "${config.search.provider}".`);
  }

  return {
    ok: true,
    provider: config.search.provider,
    query: query.trim(),
    count: results.filter((row) => row.url).length,
    results: results.filter((row) => row.url),
  };
}
