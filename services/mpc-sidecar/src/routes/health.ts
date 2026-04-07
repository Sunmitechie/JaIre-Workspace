import { Router } from "express";
import { config } from "../config.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "jaire-mpc-sidecar",
    version: "0.1.0",
    web3auth_network: config.web3auth.network,
    solana_rpc: config.solana.rpcUrl,
    timestamp: new Date().toISOString(),
  });
});

export default router;
