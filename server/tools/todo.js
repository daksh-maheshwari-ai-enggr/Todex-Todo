import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "../prisma.js";

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

// Resolve the trusted owner id from the graph runtime. This value is injected
// by server-side code when the graph is invoked; it is NEVER read from the
// model-generated tool arguments, so the model cannot act on behalf of another
// user or override ownership.
function requireUserId(runtime) {
  const userId = runtime?.state?.userId;
  if (!userId || typeof userId !== "string") {
    throw new Error("Missing authenticated user context for tool execution.");
  }
  return userId;
}

// Shape returned to the model. Deliberately excludes userId so the model never
// sees or echoes ownership identifiers.
function toPublicTodo(todo) {
  return {
    id: todo.id,
    title: todo.title,
    description: todo.description,
    completed: todo.completed,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
  };
}

export const todoCreateTool = tool(
  async (input, runtime) => {
    const userId = requireUserId(runtime);

    const todo = await prisma.todo.create({
      data: {
        userId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
      },
    });

    return { ok: true, todo: toPublicTodo(todo) };
  },
  {
    name: "todo_create",
    description:
      "Create a new task for the current user. Use when the user asks to add, " +
      "create, or remember a task or todo item.",
    schema: z.object({
      title: z
        .string()
        .min(1)
        .max(MAX_TITLE_LENGTH)
        .describe("Short title of the task."),
      description: z
        .string()
        .max(MAX_DESCRIPTION_LENGTH)
        .optional()
        .describe("Optional longer details for the task."),
    }),
  },
);

export const todoListTool = tool(
  async (input, runtime) => {
    const userId = requireUserId(runtime);

    const where = { userId };
    if (typeof input.completed === "boolean") {
      where.completed = input.completed;
    }

    const todos = await prisma.todo.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 50,
    });

    return { ok: true, count: todos.length, todos: todos.map(toPublicTodo) };
  },
  {
    name: "todo_list",
    description:
      "List the current user's tasks. Use when the user asks what tasks they " +
      "have, what is left to do, or to review completed tasks.",
    schema: z.object({
      completed: z
        .boolean()
        .optional()
        .describe("When set, only return tasks matching this completion status."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum number of tasks to return (default 50, max 100)."),
    }),
  },
);

export const todoUpdateTool = tool(
  async (input, runtime) => {
    const userId = requireUserId(runtime);

    const data = {};
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.description !== undefined) {
      data.description = input.description ? input.description.trim() : null;
    }
    if (input.completed !== undefined) data.completed = input.completed;

    if (Object.keys(data).length === 0) {
      throw new Error("No updatable fields were provided.");
    }

    // Scope the lookup to the trusted owner before mutating.
    const existing = await prisma.todo.findFirst({
      where: { id: input.id, userId },
    });

    if (!existing) {
      throw new Error("Todo not found or does not belong to the current user.");
    }

    const todo = await prisma.todo.update({
      where: { id: existing.id },
      data,
    });

    return { ok: true, todo: toPublicTodo(todo) };
  },
  {
    name: "todo_update",
    description:
      "Update an existing task for the current user, such as renaming it, " +
      "changing its description, or marking it complete/incomplete.",
    schema: z.object({
      id: z.string().min(1).describe("The id of the task to update."),
      title: z
        .string()
        .min(1)
        .max(MAX_TITLE_LENGTH)
        .optional()
        .describe("New title for the task."),
      description: z
        .string()
        .max(MAX_DESCRIPTION_LENGTH)
        .optional()
        .describe("New description for the task."),
      completed: z
        .boolean()
        .optional()
        .describe("Set to true when the task is done, false otherwise."),
    }),
  },
);

export const todoDeleteTool = tool(
  async (input, runtime) => {
    const userId = requireUserId(runtime);

    // Scope the lookup to the trusted owner before deleting.
    const existing = await prisma.todo.findFirst({
      where: { id: input.id, userId },
    });

    if (!existing) {
      throw new Error("Todo not found or does not belong to the current user.");
    }

    await prisma.todo.delete({ where: { id: existing.id } });

    return { ok: true, deletedId: existing.id };
  },
  {
    name: "todo_delete",
    description: "Delete one of the current user's tasks by id.",
    schema: z.object({
      id: z.string().min(1).describe("The id of the task to delete."),
    }),
  },
);
