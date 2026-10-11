import { defineConfig } from "@trigger.dev/sdk";

// Trigger.dev project configuration. This file is read by the Trigger.dev CLI
// and build step (`npx trigger.dev@latest dev|deploy`), never by the Express
// server at runtime. Dispatch from the server only needs TRIGGER_SECRET_KEY;
// `project` is required by the CLI and comes from the Trigger.dev dashboard.
//
// Task definitions live in ./trigger and reuse the existing server modules
// (agent, chat orchestration, tools, Daytona sandbox service) rather than
// reimplementing them. Environment variables used by those modules must also be
// configured in the Trigger.dev dashboard, because tasks execute in Trigger.dev
// infrastructure and not on the Express host.
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF || "proj_replace_me",
  dirs: ["./trigger"],
  maxDuration: Number(process.env.TRIGGER_JOB_MAX_DURATION_SEC) || 900,
  retries: {
    // Automatic retries stay off in `trigger dev` so local runs are predictable;
    // deployed runs retry transient provider/network failures.
    enabledInDev: false,
    default: {
      maxAttempts: Number(process.env.TRIGGER_JOB_MAX_ATTEMPTS) || 3,
      factor: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
      randomize: true,
    },
  },
});
