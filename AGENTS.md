# AGENTS.md — Todex-todo

## 1. Project Overview

Build an AI Teammates application inspired by:
https://github.com/code-with-antonio/ai-teammates

The application allows users to create AI teammates with specific jobs, chat with them, share memory across conversations, and eventually delegate work between teammates and control isolated cloud computers.

Build the application incrementally using the existing codebase.

## 2. Mandatory Tech Stack

- Frontend: React.js with Vite
- Language: JavaScript (ES modules)
- Backend: Node.js with Express.js
- Database: PostgreSQL hosted on Neon
- ORM: Prisma
- Authentication: Custom JWT authentication
- Password hashing: bcrypt
- Frontend routing: React Router
- API communication: REST APIs
- AI integration: A compatible LLM provider and tool-calling API
- Streaming: Server-Sent Events (SSE) where appropriate

Do not introduce Next.js, Clerk, Drizzle ORM, or another database.

## 3. Architecture Rules

- Keep frontend and backend separate in `client/` and `server/`.
- React must communicate with Express through HTTP APIs.
- Never connect React directly to PostgreSQL.
- Keep routes, controllers, services, middleware, and database access organized.
- Keep AI agent logic separate from Express route handlers.
- Keep tools modular and register them through a central tool registry.
- Keep memory management separate from chat handling.
- Keep sandbox execution behind a dedicated service.
- Use a modular monolith. Do not introduce microservices without an explicit requirement.
- Reuse existing code and patterns instead of creating duplicate implementations.

## 4. Coding Rules

- Use JavaScript and ES modules consistently.
- Prefer small, readable functions with clear responsibilities.
- Use async/await for asynchronous operations.
- Use meaningful variable and function names.
- Avoid unnecessary abstractions, generic frameworks, and excessive files.
- Follow the existing folder structure.
- Do not rewrite working modules when a focused change is sufficient.
- Do not add dependencies unless they are needed for the current feature.
- Never silently change the project's chosen technology stack.

## 5. Database Rules

- Use Prisma for all database access.
- Define relationships, foreign keys, unique constraints, and indexes appropriately.
- Associate user-owned resources with their owner.
- Enforce ownership checks in backend services.
- Use Prisma migrations for schema changes.
- Never access the database directly from the frontend.
- Never expose database credentials to the browser.
- Keep Neon connection strings in environment variables.

## 6. Authentication and Security

- Implement custom JWT authentication; do not use Clerk.
- Hash passwords with bcrypt before storing them.
- Never store plaintext passwords.
- Keep JWT secrets on the backend.
- Validate incoming request data on the server.
- Authenticate protected routes through middleware.
- Verify resource ownership on every relevant operation.
- Never trust user IDs, teammate IDs, chat IDs, or permissions supplied by the browser without checking them.
- Add appropriate rate limits to authentication and expensive AI endpoints.
- Never execute AI-generated shell commands directly on the host machine.
- Require isolated execution environments and strict limits for shell and computer tools.

## 7. AI Agent Rules

- Keep prompts, agent execution, tools, memory, and teammate handoffs in separate modules.
- Give every teammate its own job description and instructions.
- Pass relevant conversation history to the model.
- Persist user messages, assistant messages, and relevant tool-call results.
- Support streamed responses when implementing chat.
- Validate tool arguments before execution.
- Return tool results to the agent when another reasoning step is required.
- Limit agent steps, execution time, and model usage.
- Prevent infinite tool loops and teammate handoff cycles.
- Implement cross-chat memory with explicit persistence.
- Never expose API keys or internal secrets to the model or frontend.

## 8. Vibecoding Workflow

- Work only on the feature requested in the current prompt.
- Read the existing relevant files before making changes.
- Do not generate the entire application in one step.
- Do not create future-phase features prematurely.
- Do not replace existing files or restructure the project unnecessarily.
- If a required architectural decision is unclear, ask before making a major change.
- Keep changes focused and compatible with existing modules.
- Do not claim that a feature works unless it has actually been verified.
- Avoid lengthy verification during feature creation unless explicitly requested. Perform broader verification in the dedicated verification phase.
- Never delete user data or perform destructive database operations without explicit approval.

## 9. Environment Variables

- Keep real secrets in local environment files.
- Commit `.env.example` with variable names and placeholder values only.
- Ensure `.env`, `.env.local`, API keys, JWT secrets, and database credentials are ignored by Git.
- Never hardcode production credentials.
- Use separate development and production configuration.

## 10. Scope Control

Implement features in the order specified by the user.

The planned development sequence is:

1. Project foundation
2. Prisma and Neon database setup
3. JWT authentication
4. Dashboard UI
5. Teammate CRUD
6. Chats and message persistence
7. AI agent and streaming
8. Memory and tool registry
9. Group chats and teammate handoffs
10. Isolated sandbox and desktop control
11. Durable background execution and usage metering
12. Production hardening and deployment
13. Human-in-the-loop: approvals, ask_user tool, pause/resume (see ROADMAP.md Phase A)
14. Long-horizon durable runs with persisted tool context (ROADMAP.md Phase B)
15. Browser takeover: user drives the sandbox browser while the agent waits (ROADMAP.md Phase C)
16. Scheduling and proactive tasks (ROADMAP.md Phase D)
17. External actions: Gmail messaging with send approval gate (ROADMAP.md Phase E)

Do not implement later phases unless explicitly requested.

## 11. Git Rules

- Never overwrite `.env` files or commit secrets.
- Do not automatically commit, push, or change Git branches.
- Do not delete existing project files without permission.
- Preserve unrelated user changes.

## 12. Infrastructure and External Services

The project is inspired by the architecture of code-with-antonio/ai-teammates.

### Daytona
- Use Daytona for isolated cloud development sandboxes for AI teammates.
- Sandbox operations must go through a dedicated backend sandbox service.
- Support file operations and terminal execution first; add desktop control, mouse, keyboard, and screenshots in later phases.
- Never execute AI-generated shell commands directly on the application server or developer's host machine.
- Do not integrate Daytona until the sandbox implementation phase.

### Trigger.dev
- Use Trigger.dev for durable background execution and long-running AI agent tasks.
- Keep agent execution logic separate from Trigger.dev task definitions.
- Add retries, timeouts, execution limits, and failure handling where appropriate.
- Do not integrate Trigger.dev until the durable execution phase.

### Integration Rules
- Keep the application as a modular monolith using React, Express, Prisma, and Neon PostgreSQL.
- Daytona and Trigger.dev are supporting infrastructure, not replacements for Express or Prisma.
- Do not introduce microservices or additional infrastructure unless explicitly requested.
- Do not install or configure these services during the initial project foundation phase.
- Preserve the planned implementation order and introduce each dependency only when its feature is implemented.