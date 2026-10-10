import express from "express";
import authRoutes from "./routes/auth.js";
import botsRoutes from "./routes/bots.js";
import { config } from "./config.js";

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/bots", botsRoutes);

app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});

export default app;