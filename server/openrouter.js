import { ChatOpenAI } from "@langchain/openai";
import { config } from "./config.js";

// OpenRouter exposes an OpenAI-compatible Chat Completions API. Use LangChain's
// ChatOpenAI chat-model client (instead of the raw OpenAI SDK) so the agent can
// invoke it through the standard LangChain message/tool-calling interface.
export function createChatModel() {
  return new ChatOpenAI({
    apiKey: config.openRouter.apiKey,
    model: config.openRouter.model,
    temperature: 0.7,
    maxTokens: 1024,
    timeout: config.openRouter.timeoutMs,
    configuration: {
      baseURL: config.openRouter.baseUrl,
    },
  });
}
