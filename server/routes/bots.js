import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createBot,
  findBotsByUserId,
  findBotByIdAndUserId,
  updateBot,
  deleteBot,
} from "../bots.js";

const router = Router();

function validateString(value, maxLength, fieldName) {
  if (typeof value !== "string") {
    throw new Error(`Invalid type for ${fieldName}: expected string`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength}`);
  }

  return trimmed;
}

function validateOptionalString(value, maxLength, fieldName) {
  if (value === undefined) return undefined;

  if (typeof value !== "string") {
    throw new Error(`Invalid type for ${fieldName}: expected string or undefined`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength}`);
  }

  return trimmed.length > 0 ? trimmed : undefined;
}

router.post("/", requireAuth, async (req, res) => {
  const { name, job, instructions } = req.body || {};

  try {
    const validatedName = validateString(name, 50, "name");
    const validatedJob = validateString(job, 100, "job");
    const validatedInstructions = validateOptionalString(instructions, 4000, "instructions");

    const bot = await createBot({
      userId: req.user.id,
      name: validatedName,
      job: validatedJob,
      instructions: validatedInstructions,
    });

    res.status(201).json({ bot });
  } catch (error) {
    console.error("Error creating bot:", error.message);
    res.status(400).json({ error: error.message });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const bots = await findBotsByUserId(req.user.id);
    res.json({ bots });
  } catch (error) {
    console.error("Error fetching bots:", error);
    res.status(500).json({ error: "Failed to fetch bots" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid bot ID" });
  }

  try {
    const bot = await findBotByIdAndUserId(id, req.user.id);
    if (!bot) {
      return res.status(404).json({ error: "Bot not found" });
    }
    res.json({ bot });
  } catch (error) {
    console.error("Error fetching bot:", error);
    res.status(500).json({ error: "Failed to fetch bot" });
  }
});

router.patch("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, job, instructions } = req.body || {};

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid bot ID" });
  }

  try {
    const updateData = {};

    if (name !== undefined) {
      const validatedName = validateString(name, 50, "name");
      updateData.name = validatedName;
    }

    if (job !== undefined) {
      const validatedJob = validateString(job, 100, "job");
      updateData.job = validatedJob;
    }

    if (instructions !== undefined) {
      const validatedInstructions = validateOptionalString(instructions, 4000, "instructions");
      updateData.instructions = validatedInstructions;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    const bot = await updateBot(id, req.user.id, updateData);
    if (!bot) {
      return res.status(404).json({ error: "Bot not found or does not belong to the authenticated user" });
    }

    res.json({ bot });
  } catch (error) {
    console.error("Error updating bot:", error.message);
    res.status(400).json({ error: error.message });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid bot ID" });
  }

  try {
    const bot = await deleteBot(id, req.user.id);
    if (!bot) {
      return res.status(404).json({ error: "Bot not found or does not belong to the authenticated user" });
    }
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting bot:", error);
    res.status(500).json({ error: "Failed to delete bot" });
  }
});

export default router;