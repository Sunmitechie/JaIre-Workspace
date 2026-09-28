import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import healthRouter from "./routes/health.js";
import mpcRouter from "./routes/mpc.js";
import { logger } from "./lib/logger.js";

const app = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cors());
app.use(express.json());

app.use("/health", healthRouter);
app.use("/mpc", mpcRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default app;
