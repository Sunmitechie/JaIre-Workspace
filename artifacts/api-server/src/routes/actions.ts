/**
 * JaIre Solana Actions — Blink endpoints
 *
 * Implements the Solana Actions / Blink spec (https://solana.com/docs/advanced/actions).
 * These endpoints let Phantom, Backpack, and any Blink-compatible wallet trigger
 * JaIre workspace check-ins directly from a shareable URL.
 *
 * All endpoints set the required CORS + Blockchain-Ids headers.
 *
 * Routes (all prefixed /api/actions/)
 * ────────────────────────────────────
 *  GET  /actions.json               — Solana actions.json manifest
 *  GET  /workspace/:id              — Action metadata for a specific workspace
 *  POST /workspace/:id              — Returns a serialized USDC transfer tx to sign
 *  GET  /checkin                    — Generic check-in action (workspace_id in query)
 *  POST /checkin                    — Returns a serialized USDC transfer tx to sign
 *
 * Transaction flow (POST)
 * ────────────────────────
 *  1. Derive user USDC ATA (idempotent create instruction included)
 *  2. Transfer USDC: user wallet → JaIre vault
 *  3. Attach SPL Memo: JAIRE|BLINK|{workspace_id}|{hours}h
 *  4. Return base64-serialised, unsigned transaction for wallet to sign
 */

import { Router, Request, Response } from "express";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { db } from "@workspace/db";
import { workspaces, organizations } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// ── Config ─────────────────────────────────────────────────────────────────
const SOLANA_RPC = process.env["SOLANA_RPC_URL"] ?? "https://api.devnet.solana.com";
const VAULT_ADDRESS = process.env["JAIRE_VAULT_ADDRESS"] ?? "";
const USDC_MINT = new PublicKey(
  process.env["JAIRE_TEST_MINT"] ?? "7egxbd4d6tsPsRKJU8v74PKFnis4YKhbQgKX9HDCpR8S",
);
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const JAIRE_ICON_URL = "https://ja-ire.replit.app/jaire-icon.png";
const JAIRE_BASE_URL = process.env["JAIRE_PUBLIC_URL"] ?? "https://ja-ire.replit.app";
const NGN_PER_USDC = 1600;

// ── Solana Actions CORS middleware ─────────────────────────────────────────
function actionsCors(req: Request, res: Response, next: () => void) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("X-Action-Version", "2.4");
  res.setHeader("X-Blockchain-Ids", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
}

router.use(actionsCors);

// ── Helpers ────────────────────────────────────────────────────────────────
function memoIx(memo: string): TransactionInstruction {
  return new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf-8"),
  });
}

async function buildUsdcTransferTx(
  userWallet: PublicKey,
  atomicAmount: number,
  memo: string,
): Promise<Transaction> {
  const connection = new Connection(SOLANA_RPC, "confirmed");

  if (!VAULT_ADDRESS) throw new Error("JAIRE_VAULT_ADDRESS not configured");
  const vault = new PublicKey(VAULT_ADDRESS);

  const userATA  = getAssociatedTokenAddressSync(USDC_MINT, userWallet);
  const vaultATA = getAssociatedTokenAddressSync(USDC_MINT, vault);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    blockhash,
    lastValidBlockHeight,
    feePayer: userWallet,
  });

  // Idempotent: create user ATA if it doesn't exist yet
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      userWallet,  // payer
      userATA,
      userWallet,  // owner
      USDC_MINT,
    ),
  );

  // Transfer: user ATA → vault ATA
  tx.add(
    createTransferInstruction(userATA, vaultATA, userWallet, atomicAmount, [], TOKEN_PROGRAM_ID),
  );

  // On-chain memo for traceability
  tx.add(memoIx(memo));

  return tx;
}

function serializeTx(tx: Transaction): string {
  return Buffer.from(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  ).toString("base64");
}

// ── GET /api/actions/actions.json ──────────────────────────────────────────
router.get("/actions.json", (_req: Request, res: Response) => {
  res.json({
    rules: [
      { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
      { pathPattern: "/**",             apiPath: "/api/actions/**" },
    ],
  });
});

// ── GET /api/actions/workspace/:id ────────────────────────────────────────
router.get("/workspace/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    if (!ws) { res.status(404).json({ error: "Workspace not found" }); return; }

    const rateNgn = ws.hourlyRateNgn ?? 5000;
    const rateUsdc = ws.hourlyRateUsdc ?? (rateNgn / NGN_PER_USDC);

    res.json({
      icon:        ws.imageUrl ?? JAIRE_ICON_URL,
      title:       `Check in to ${ws.name}`,
      description: [
        ws.description ?? "A JaIre coworking workspace.",
        `₦${rateNgn.toLocaleString()}/hr · ${rateUsdc.toFixed(2)} USDC/hr`,
        ws.amenities ? `Amenities: ${ws.amenities}` : "",
      ].filter(Boolean).join(" • "),
      label:       "Check In",
      links: {
        actions: [
          {
            type:  "transaction",
            label: "1 hour",
            href:  `${JAIRE_BASE_URL}/api/actions/workspace/${id}?hours=1`,
          },
          {
            type:  "transaction",
            label: "2 hours",
            href:  `${JAIRE_BASE_URL}/api/actions/workspace/${id}?hours=2`,
          },
          {
            type:  "transaction",
            label: "4 hours",
            href:  `${JAIRE_BASE_URL}/api/actions/workspace/${id}?hours=4`,
          },
          {
            type:  "transaction",
            label: "Full day (8h)",
            href:  `${JAIRE_BASE_URL}/api/actions/workspace/${id}?hours=8`,
          },
        ],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ── POST /api/actions/workspace/:id ───────────────────────────────────────
router.post("/workspace/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const hours = Math.min(Math.max(parseFloat((req.query["hours"] as string) ?? "1"), 0.5), 24);
    const { account } = req.body as { account?: string };

    if (!account) { res.status(400).json({ error: "account (wallet address) required" }); return; }

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    if (!ws) { res.status(404).json({ error: "Workspace not found" }); return; }
    if (!ws.isAvailable) { res.status(400).json({ error: "Workspace is not available right now" }); return; }

    const rateUsdc = ws.hourlyRateUsdc ?? ((ws.hourlyRateNgn ?? 5000) / NGN_PER_USDC);
    const totalUsdc = rateUsdc * hours;
    const atomicAmount = Math.round(totalUsdc * 1_000_000);
    const memo = `JAIRE|BLINK|${id.slice(0, 8)}|${hours}h|${totalUsdc.toFixed(2)}USDC`;

    const userWallet = new PublicKey(account);
    const tx = await buildUsdcTransferTx(userWallet, atomicAmount, memo);

    console.log(
      `[blink/workspace] ${hours}h @ ${ws.name} account=${account.slice(0, 8)}… ` +
      `${totalUsdc.toFixed(4)} USDC`,
    );

    res.json({
      transaction: serializeTx(tx),
      message: `Check-in to ${ws.name} for ${hours}h — ${totalUsdc.toFixed(2)} USDC. Sign to confirm.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ── GET /api/actions/checkin ───────────────────────────────────────────────
// Generic check-in Blink — shows workspace picker if no workspace_id given
router.get("/checkin", async (req: Request, res: Response) => {
  try {
    const wsId = (req.query["workspace_id"] as string | undefined) ?? null;

    if (wsId) {
      // Redirect to workspace-specific action
      req.params.id = wsId;
      // Delegate to workspace handler — just re-query
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
      if (!ws) { res.status(404).json({ error: "Workspace not found" }); return; }

      const rateNgn  = ws.hourlyRateNgn ?? 5000;
      const rateUsdc = ws.hourlyRateUsdc ?? (rateNgn / NGN_PER_USDC);

      res.json({
        icon:        ws.imageUrl ?? JAIRE_ICON_URL,
        title:       `Check in to ${ws.name}`,
        description: `${ws.description ?? "JaIre coworking workspace"} · ₦${rateNgn.toLocaleString()}/hr`,
        label:       "Check In",
        links: {
          actions: [
            { type: "transaction", label: "1 hour",       href: `${JAIRE_BASE_URL}/api/actions/checkin?workspace_id=${wsId}&hours=1` },
            { type: "transaction", label: "2 hours",      href: `${JAIRE_BASE_URL}/api/actions/checkin?workspace_id=${wsId}&hours=2` },
            { type: "transaction", label: "4 hours",      href: `${JAIRE_BASE_URL}/api/actions/checkin?workspace_id=${wsId}&hours=4` },
            { type: "transaction", label: "Full day (8h)", href: `${JAIRE_BASE_URL}/api/actions/checkin?workspace_id=${wsId}&hours=8` },
          ],
        },
      });
    } else {
      // Show all available workspaces as action links
      const availableWs = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.isAvailable, true))
        .limit(10);

      res.json({
        icon:        JAIRE_ICON_URL,
        title:       "Check in to a JaIre Workspace",
        description: "Web3-powered coworking in Lagos. Pay per second in USDC — fully on-chain.",
        label:       "Choose Workspace",
        links: {
          actions: availableWs.length > 0
            ? availableWs.map((w) => ({
                type:  "transaction",
                label: `${w.name} — ₦${(w.hourlyRateNgn ?? 5000).toLocaleString()}/hr`,
                href:  `${JAIRE_BASE_URL}/api/actions/checkin?workspace_id=${w.id}&hours=2`,
              }))
            : [{ type: "external-link", label: "Browse Workspaces", href: `${JAIRE_BASE_URL}/workspaces` }],
        },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ── POST /api/actions/checkin ──────────────────────────────────────────────
router.post("/checkin", async (req: Request, res: Response) => {
  try {
    const wsId  = (req.query["workspace_id"] as string | undefined) ?? null;
    const hours = Math.min(Math.max(parseFloat((req.query["hours"] as string) ?? "2"), 0.5), 24);
    const { account } = req.body as { account?: string };

    if (!account)  { res.status(400).json({ error: "account required" }); return; }
    if (!wsId)     { res.status(400).json({ error: "workspace_id required" }); return; }

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
    if (!ws)               { res.status(404).json({ error: "Workspace not found" }); return; }
    if (!ws.isAvailable)   { res.status(400).json({ error: "Workspace unavailable" }); return; }

    const rateUsdc    = ws.hourlyRateUsdc ?? ((ws.hourlyRateNgn ?? 5000) / NGN_PER_USDC);
    const totalUsdc   = rateUsdc * hours;
    const atomicAmount = Math.round(totalUsdc * 1_000_000);
    const memo = `JAIRE|BLINK|${wsId.slice(0, 8)}|${hours}h|${totalUsdc.toFixed(2)}USDC`;

    const userWallet = new PublicKey(account);
    const tx = await buildUsdcTransferTx(userWallet, atomicAmount, memo);

    res.json({
      transaction: serializeTx(tx),
      message: `Check-in to ${ws.name} for ${hours}h — ${totalUsdc.toFixed(2)} USDC. Sign to confirm.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
