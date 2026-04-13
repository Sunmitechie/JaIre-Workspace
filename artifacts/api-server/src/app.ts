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

// Forward /jaire/* and /api/jaire/* requests to the Python FastAPI service on port 8000.
// Runs BEFORE body parsers so raw request bodies are streamed intact.
// In dev: Vite proxies /jaire/* directly here. In production: frontend calls /api/jaire/*.
function makePythonProxy() {
  return (req: express.Request, res: express.Response) => {
    // req.url is relative to the mount point, e.g. "/wallet/create"
    const forwardPath = `/jaire${req.url}`;
    const options: http.RequestOptions = {
      hostname: "localhost",
      port: 8000,
      path: forwardPath,
      method: req.method,
      headers: { ...req.headers, host: "localhost:8000" },
    };
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });
    proxyReq.on("error", () => {
      if (!res.headersSent) res.status(502).json({ error: "JaIre Python service unavailable" });
    });
    req.pipe(proxyReq, { end: true });
  };
}

app.use("/jaire", makePythonProxy());
app.use("/api/jaire", makePythonProxy());

// Forward /mpc/* and /api/mpc/* to the MPC Sidecar on port 9000 (Web3Auth key mgmt)
function makeMpcProxy() {
  return (req: express.Request, res: express.Response) => {
    const forwardPath = `/mpc${req.url}`;
    const options: http.RequestOptions = {
      hostname: "localhost",
      port: 9000,
      path: forwardPath,
      method: req.method,
      headers: { ...req.headers, host: "localhost:9000" },
    };
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });
    proxyReq.on("error", () => {
      if (!res.headersSent) res.status(502).json({ error: "MPC Sidecar unavailable" });
    });
    req.pipe(proxyReq, { end: true });
  };
}

app.use("/mpc", makeMpcProxy());
app.use("/api/mpc", makeMpcProxy());

// Paystack webhook needs raw body for HMAC-SHA512 signature verification.
// Mount express.raw() BEFORE express.json() so the buffer is preserved.
app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Public config — exposes non-secret client-side keys
app.get("/api/config", (_req, res) => {
  res.json({
    web3authClientId: process.env["WEB3AUTH_CLIENT_ID"] ?? "",
    web3authNetwork: "sapphire_devnet",
  });
});

app.use("/api", router);

export default app;
