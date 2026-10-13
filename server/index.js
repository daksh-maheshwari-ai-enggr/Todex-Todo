import express from "express";
import authRoutes from "./routes/auth.js";
import botsRoutes from "./routes/bots.js";
import chatsRoutes from "./routes/chats.js";
import messagesRoutes from "./routes/messages.js";
import agentsRoutes from "./routes/agents.js";
import toolExecutionsRoutes from "./routes/toolExecutions.js";
import handoffsRoutes from "./routes/handoffs.js";
import jobsRoutes from "./routes/jobs.js";
import activityRoutes from "./routes/activity.js";
import sandboxViewRoutes from "./routes/sandboxView.js";
import approvalsRoutes from "./routes/approvals.js";
import { config } from "./config.js";

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/bots", botsRoutes);
app.use("/api/chats", chatsRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/agents", agentsRoutes);
app.use("/api/tool-executions", toolExecutionsRoutes);
app.use("/api/handoffs", handoffsRoutes);
app.use("/api/jobs", jobsRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/sandbox", sandboxViewRoutes);
app.use("/api/approvals", approvalsRoutes);

app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});

export default app;