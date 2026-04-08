import http from "http";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors());

// Forward all /jaire/* requests to the Python FastAPI service on port 8000.
// This proxy runs BEFORE body parsers so webhook HMAC verification gets the raw body.
app.use("/jaire", (req, res) => {
  const options: http.RequestOptions = {
    hostname: "localhost",
    port: 8000,
    path: req.originalUrl,
    method: req.method,
    headers: { ...req.headers, host: "localhost:8000" },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.status(502).json({ error: "JaIre Python service unavailable" });
    }
  });

  req.pipe(proxyReq, { end: true });
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);

export default app;
