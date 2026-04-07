import { readFileSync } from "fs";

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export const config = {
  port: parseInt(process.env.MPC_SIDECAR_PORT ?? "9000", 10),

  web3auth: {
    clientId: require_env("WEB3AUTH_CLIENT_ID"),
    nodeFactorKey: require_env("WEB3AUTH_NODE_FACTOR_KEY"),
    network: (process.env.WEB3AUTH_NETWORK ?? "sapphire_devnet") as string,
    jwksUrl: "https://api-auth.web3auth.io/jwks",
  },

  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    network: "devnet",
  },

  python_api: {
    baseUrl: process.env.PYTHON_API_URL ?? "http://localhost:8000",
  },
};
