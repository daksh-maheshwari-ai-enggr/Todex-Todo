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
};