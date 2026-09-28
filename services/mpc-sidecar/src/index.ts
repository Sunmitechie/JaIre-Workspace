import app from "./app.js";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";

const PORT = config.port;

app.listen(PORT, "0.0.0.0", () => {
  logger.info({ port: PORT, network: config.web3auth.network, rpcUrl: config.solana.rpcUrl }, "[MPC Sidecar] listening");
});
