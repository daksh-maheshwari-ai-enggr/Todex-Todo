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
  },
};