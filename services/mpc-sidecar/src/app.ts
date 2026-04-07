import express from "express";
import cors from "cors";
import healthRouter from "./routes/health.js";
import mpcRouter from "./routes/mpc.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/health", healthRouter);
app.use("/mpc", mpcRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default app;
