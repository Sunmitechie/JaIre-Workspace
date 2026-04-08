import { SolanaAgentKit, createLangchainTools } from "solana-agent-kit";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import type { DynamicStructuredTool } from "@langchain/core/tools";

let _solanaTools: DynamicStructuredTool[] | null = null;

function getSolanaAgentKit(): SolanaAgentKit | null {
  const privateKeyB58 = process.env["JAIRE_TREASURY_PRIVATE_KEY"];
  const rpcUrl = process.env["SOLANA_RPC_URL"] ?? "https://api.devnet.solana.com";

  if (!privateKeyB58) {
    return null;
  }

  try {
    let privateKeyBytes: Uint8Array;
    if (/^[0-9a-fA-F]{128}$/.test(privateKeyB58)) {
      privateKeyBytes = Uint8Array.from(Buffer.from(privateKeyB58, "hex"));
    } else if (/^\[/.test(privateKeyB58)) {
      privateKeyBytes = Uint8Array.from(JSON.parse(privateKeyB58) as number[]);
    } else {
      privateKeyBytes = bs58.decode(privateKeyB58);
    }
    const keypair = Keypair.fromSecretKey(privateKeyBytes);

    const agent = new SolanaAgentKit(
      {
        publicKey: keypair.publicKey,
        signTransaction: async (tx) => {
          if ("sign" in tx && typeof tx.sign === "function") {
            tx.sign([keypair]);
          } else if ("partialSign" in tx && typeof tx.partialSign === "function") {
            (tx as any).partialSign(keypair);
          }
          return tx as any;
        },
        signAllTransactions: async (txs) => {
          return txs.map((tx) => {
            if ("sign" in tx && typeof tx.sign === "function") {
              tx.sign([keypair]);
            } else if ("partialSign" in tx && typeof tx.partialSign === "function") {
              (tx as any).partialSign(keypair);
            }
            return tx;
          }) as any;
        },
        signMessage: async (msg) => {
          const { sign } = await import("@noble/ed25519");
          return sign(msg, keypair.secretKey.slice(0, 32));
        },
        sendTransaction: async () => {
          throw new Error("Baire is in read-only mode — transactions require user authorization.");
        },
      } as any,
      rpcUrl,
      {
        OPENAI_API_KEY: process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] ?? "dummy",
        signOnly: true,
      }
    );

    return agent;
  } catch (err) {
    console.error("[Baire Solana] Failed to initialize SolanaAgentKit:", err);
    return null;
  }
}

export function getSolanaTools(): DynamicStructuredTool[] {
  if (_solanaTools !== null) {
    return _solanaTools;
  }

  const agent = getSolanaAgentKit();
  if (!agent) {
    _solanaTools = [];
    return _solanaTools;
  }

  try {
    const allActions = (agent as any).actions ?? [];
    const readOnlyActions = allActions.filter((a: any) =>
      ["GET_BALANCE", "GET_TOKEN_BALANCE", "GET_TOKEN_DATA"].includes(a.name)
    );

    _solanaTools = createLangchainTools(agent, readOnlyActions) as unknown as DynamicStructuredTool[];
  } catch (err) {
    console.error("[Baire Solana] Failed to create LangChain tools:", err);
    _solanaTools = [];
  }

  return _solanaTools;
}
