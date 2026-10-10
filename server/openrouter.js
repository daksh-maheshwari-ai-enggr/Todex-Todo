import { OpenAI } from "@langchain/openai";
import { config } from "./config.js";

// Create OpenRouter-compatible OpenAI client
const openRouterClient = new OpenAI({
  apiKey: config.openRouter.apiKey,
  baseURL: config.openRouter.baseUrl,
  modelName: config.openRouter.model,
  temperature: 0.7,
  maxTokens: 1024,
  timeout: 30000,
});

export { openRouterClient };