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

function sanitizeString(value, maxLength) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.slice(0, maxLength);
}

router.post("/", requireAuth, async (req, res) => {
  const { name, job, instructions } = req.body || {};

  if (!name || !job) {
    return res.status(400).json({ error: "name and job are required" });
  }

  const sanitizedName = sanitizeString(name, 50);
  const sanitizedJob = sanitizeString(job, 100);
  const sanitizedInstructions = sanitizeString(instructions || "", 4000);

  if (sanitizedName === "") {
    return res.status(400).json({ error: "name is required" });
  }

  if (sanitizedJob === "") {
    return res.status(400).json({ error: "job is required" });
  }

  // Generate a simple avatar seed - in production this could be more sophisticated
  const avatarSeed = Math.random().toString(36).substring(2, 8);

  try {
    const bot = await createBot({
      userId: req.user.id,
      name: sanitizedName,
      avatar: avatarSeed,
      job: sanitizedJob,
      instructions: sanitizedInstructions || undefined,
    });

    res.status(201).json({ bot });
  } catch (error) {
    console.error("Error creating bot:", error);
    res.status(500).json({ error: "Failed to create bot" });
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

  const updateData = {};

  if (name !== undefined) {
    const sanitizedName = sanitizeString(name, 50);
    if (sanitizedName === "") {
      return res.status(400).json({ error: "name cannot be empty" });
    }
    updateData.name = sanitizedName;
  }

  if (job !== undefined) {
    const sanitizedJob = sanitizeString(job, 100);
    if (sanitizedJob === "") {
      return res.status(400).json({ error: "job cannot be empty" });
    }
    updateData.job = sanitizedJob;
  }

  if (instructions !== undefined) {
    updateData.instructions = sanitizeString(instructions, 4000) || undefined;
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  try {
    const bot = await updateBot(id, updateData);
    if (!bot) {
      return res.status(404).json({ error: "Bot not found" });
    }
    res.json({ bot });
  } catch (error) {
    console.error("Error updating bot:", error);
    res.status(500).json({ error: "Failed to update bot" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid bot ID" });
  }

  try {
    const bot = await deleteBot(id);
    if (!bot) {
      return res.status(404).json({ error: "Bot not found" });
    }
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting bot:", error);
    res.status(500).json({ error: "Failed to delete bot" });
  }
});

export default router;