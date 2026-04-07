import app from "./app.js";
import { config } from "./config.js";

const PORT = config.port;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[MPC Sidecar] listening on port ${PORT}`);
  console.log(`[MPC Sidecar] Web3Auth network: ${config.web3auth.network}`);
  console.log(`[MPC Sidecar] Solana RPC: ${config.solana.rpcUrl}`);
});
