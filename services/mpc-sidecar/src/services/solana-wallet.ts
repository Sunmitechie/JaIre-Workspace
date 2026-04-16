/**
 * Solana wallet operations for the MPC sidecar.
 *
 * Responsibilities:
 *   - Parse treasury keypair from env (hex / base58 / JSON array)
 *   - USDC balance queries for any address
 *   - Fund user wallets with test USDC from treasury (devnet only)
 *   - Co-sign USDC transfers from a user's derived devnet keypair
 *
 * IMPORTANT: `deriveUserDevnetKeypair` is a SIMULATION of TSS.
 * In production the server only holds a *share* — never the full key.
 * Replace the sign-and-send logic with a proper TSS ceremony before mainnet.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  createMintToInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// ── SPL Memo program ───────────────────────────────────────────────────────
// Attaches a UTF-8 string to any Solana transaction. Visible on Solana Explorer.
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function buildMemoInstruction(memo: string): TransactionInstruction {
  return new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo.slice(0, 566), "utf-8"), // memo max ~566 bytes on-chain
  });
}
import bs58 from "bs58";
import { config } from "../config.js";
import { deriveUserDevnetKeypair } from "./mpc-service.js";

// ── Constants ──────────────────────────────────────────────────────────────

/** Devnet USDC test mint — created and controlled by JaIre treasury */
const DEFAULT_TEST_MINT = process.env.JAIRE_TEST_MINT ?? "7egxbd4d6tsPsRKJU8v74PKFnis4YKhbQgKX9HDCpR8S";

/** USDC has 6 decimals */
const USDC_DECIMALS = 6;

// ── Singleton connection ───────────────────────────────────────────────────

let _connection: Connection | null = null;

export function getSolanaConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(config.solana.rpcUrl, "confirmed");
  }
  return _connection;
}

// ── Treasury keypair parsing ───────────────────────────────────────────────

let _treasury: Keypair | null = null;

/**
 * Parse any common Solana keypair format into a Keypair.
 * Supported formats:
 *   - JSON byte array: [1,2,3,…]  (32 bytes → seed, 64 bytes → full keypair)
 *   - 64-char hex: 32-byte seed
 *   - 128-char hex: 64-byte full keypair
 *   - Base64: decoded as-is; 32 bytes → seed, 64 bytes → full keypair
 *   - Base58: decoded as-is; 32 bytes → seed, 64 bytes → full keypair
 */
function parseKeypair(raw: string, name: string): Keypair {
  const trimmed = raw.trim();
  let bytes: Uint8Array;

  if (trimmed.startsWith("[")) {
    // JSON byte array
    bytes = Uint8Array.from(JSON.parse(trimmed) as number[]);
  } else if (/^[0-9a-fA-F]{128}$/.test(trimmed)) {
    // 128 hex chars = 64-byte full keypair
    bytes = Uint8Array.from(Buffer.from(trimmed, "hex"));
  } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    // 64 hex chars = 32-byte seed
    bytes = Uint8Array.from(Buffer.from(trimmed, "hex"));
  } else if (/[+/=]/.test(trimmed)) {
    // Base64 (contains chars not in base58 or hex alphabet)
    bytes = Uint8Array.from(Buffer.from(trimmed, "base64"));
  } else {
    // Try base58
    try {
      bytes = bs58.decode(trimmed);
    } catch {
      throw new Error(
        `${name}: unrecognised key format (length=${trimmed.length}). ` +
        `Supported: JSON array, 64-char hex (seed), 128-char hex (full), base64, base58.`
      );
    }
  }

  // Choose constructor based on byte length
  if (bytes.length === 32) {
    return Keypair.fromSeed(bytes);
  } else if (bytes.length === 64) {
    return Keypair.fromSecretKey(bytes);
  } else {
    throw new Error(
      `${name}: expected 32 or 64 bytes but got ${bytes.length}. Check the key value in Secrets.`
    );
  }
}

export function getTreasuryKeypair(): Keypair {
  if (_treasury) return _treasury;

  const raw = process.env.JAIRE_TREASURY_PRIVATE_KEY;
  if (!raw) throw new Error("JAIRE_TREASURY_PRIVATE_KEY not set");

  _treasury = parseKeypair(raw, "JAIRE_TREASURY_PRIVATE_KEY");
  return _treasury;
}

// ── Balance queries ────────────────────────────────────────────────────────

export interface WalletBalance {
  sol_balance: number;
  usdc_balance: number;
  usdc_mint: string;
  wallet_address: string;
}

export async function getWalletBalance(
  walletAddress: string,
  mintAddress: string = DEFAULT_TEST_MINT,
): Promise<WalletBalance> {
  const connection = getSolanaConnection();
  const pubkey = new PublicKey(walletAddress);
  const mint = new PublicKey(mintAddress);

  const solBalanceLamports = await connection.getBalance(pubkey);
  const solBalance = solBalanceLamports / 1e9;

  let usdcBalance = 0;
  try {
    const ata = await getAssociatedTokenAddress(mint, pubkey);
    const tokenAccountInfo = await connection.getTokenAccountBalance(ata);
    usdcBalance = tokenAccountInfo.value.uiAmount ?? 0;
  } catch {
    usdcBalance = 0;
  }

  return {
    sol_balance: solBalance,
    usdc_balance: usdcBalance,
    usdc_mint: mintAddress,
    wallet_address: walletAddress,
  };
}

// ── Fund user wallet from treasury ────────────────────────────────────────

export interface FundResult {
  success: boolean;
  tx_signature: string | null;
  amount_usdc: number;
  wallet_address: string;
  is_simulated: boolean;
  error?: string;
}

export async function fundUserWallet(
  walletAddress: string,
  amountUsdc: number,
  mintAddress: string = DEFAULT_TEST_MINT,
  isSimulated: boolean = false,
  memo?: string,
): Promise<FundResult> {
  if (isSimulated) {
    return {
      success: true,
      tx_signature: `SIMULATED-FUND-${walletAddress.slice(0, 8).toUpperCase()}`,
      amount_usdc: amountUsdc,
      wallet_address: walletAddress,
      is_simulated: true,
    };
  }

  try {
    const connection = getSolanaConnection();
    const treasury = getTreasuryKeypair();
    const mint = new PublicKey(mintAddress);
    const recipient = new PublicKey(walletAddress);

    // ── Activate wallet with a tiny SOL transfer if it has 0 lamports ──────
    // This makes the account visible on Solana Explorer and pays for rent.
    const existingLamports = await connection.getBalance(recipient);
    if (existingLamports === 0) {
      const ACTIVATION_SOL = 0.002; // enough for rent + future fees
      const activationTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: treasury.publicKey,
          toPubkey: recipient,
          lamports: Math.round(ACTIVATION_SOL * LAMPORTS_PER_SOL),
        }),
      );
      try {
        const activationSig = await sendAndConfirmTransaction(connection, activationTx, [treasury], {
          commitment: "confirmed",
        });
        console.log(`[solana] Activated wallet ${walletAddress.slice(0, 8)} with ${ACTIVATION_SOL} SOL tx=${activationSig}`);
      } catch (e) {
        // Non-fatal — USDC transfer can still succeed even if SOL activation fails
        console.warn(`[solana] SOL activation failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      }
    }

    const mintInfo = await getMint(connection, mint);
    const atomicAmount = Math.round(amountUsdc * Math.pow(10, mintInfo.decimals));

    // Create the recipient's ATA if it doesn't exist (treasury pays for rent)
    const toATA = await getOrCreateAssociatedTokenAccount(
      connection,
      treasury,
      mint,
      recipient,
    );

    // Mint directly to the recipient's ATA — treasury is the mint authority
    // This avoids needing USDC pre-loaded in the treasury's own balance.
    const effectiveMemo = memo ?? `JAIRE|FUND|${amountUsdc}USDC|${walletAddress.slice(0, 8)}`;
    const tx = new Transaction()
      .add(createMintToInstruction(mint, toATA.address, treasury.publicKey, atomicAmount))
      .add(buildMemoInstruction(effectiveMemo));

    const sig = await sendAndConfirmTransaction(connection, tx, [treasury], {
      commitment: "confirmed",
    });

    return {
      success: true,
      tx_signature: sig,
      amount_usdc: amountUsdc,
      wallet_address: walletAddress,
      is_simulated: false,
    };
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    if (!message && err instanceof Error) {
      // Solana SendTransactionError sometimes has logs
      const solErr = err as any;
      if (solErr.logs) message = solErr.logs.join(" | ");
      if (!message) message = JSON.stringify(err);
    }
    console.error("[solana/fundUserWallet] error:", message, err);
    return {
      success: false,
      tx_signature: null,
      amount_usdc: amountUsdc,
      wallet_address: walletAddress,
      is_simulated: false,
      error: message || "Unknown error",
    };
  }
}

// ── Vault keypair (escrow holder) ─────────────────────────────────────────

let _vault: Keypair | null = null;

export function getVaultKeypair(): Keypair {
  if (_vault) return _vault;
  const raw = process.env.JAIRE_VAULT_PRIVATE_KEY;
  if (!raw) throw new Error("JAIRE_VAULT_PRIVATE_KEY not set");
  _vault = parseKeypair(raw, "JAIRE_VAULT_PRIVATE_KEY");
  return _vault;
}

// ── Fund user wallet FROM VAULT (vault is the exchange disbursement wallet) ─

const VAULT_MIN_RESERVE_USDC = 50; // trigger auto-top-up when vault balance drops this low
const VAULT_TOPUP_USDC = 10_000;   // how much to mint into vault from treasury each top-up

export async function vaultFundUser(
  walletAddress: string,
  amountUsdc: number,
  mintAddress: string = DEFAULT_TEST_MINT,
): Promise<FundResult> {
  try {
    const connection = getSolanaConnection();
    const treasury = getTreasuryKeypair();
    const vault = getVaultKeypair();
    const mint = new PublicKey(mintAddress);
    const recipient = new PublicKey(walletAddress);
    const mintInfo = await getMint(connection, mint);
    const decimals = mintInfo.decimals;

    // ── Step 1: SOL activation (treasury pays) ───────────────────────────
    const existingLamports = await connection.getBalance(recipient);
    if (existingLamports === 0) {
      const ACTIVATION_SOL = 0.002;
      const activationTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: treasury.publicKey,
          toPubkey: recipient,
          lamports: Math.round(ACTIVATION_SOL * LAMPORTS_PER_SOL),
        }),
      );
      try {
        const sig = await sendAndConfirmTransaction(connection, activationTx, [treasury], { commitment: "confirmed" });
        console.log(`[solana] Activated wallet ${walletAddress.slice(0, 8)} with ${ACTIVATION_SOL} SOL tx=${sig}`);
      } catch (e) {
        console.warn(`[solana] SOL activation failed (non-fatal): ${e instanceof Error ? e.message : e}`);
      }
    }

    // ── Step 2: Ensure vault ATA exists (treasury pays for ATA creation) ─
    const vaultATA = await getOrCreateAssociatedTokenAccount(
      connection,
      treasury,        // payer for ATA rent
      mint,
      vault.publicKey,
    );

    // ── Step 3: Auto-top-up vault from treasury if balance is low ────────
    const vaultBalance = Number(vaultATA.amount) / Math.pow(10, decimals);
    if (vaultBalance < amountUsdc + VAULT_MIN_RESERVE_USDC) {
      const topupAtomic = Math.round(VAULT_TOPUP_USDC * Math.pow(10, decimals));
      const mintTx = new Transaction().add(
        createMintToInstruction(mint, vaultATA.address, treasury.publicKey, topupAtomic),
      );
      await sendAndConfirmTransaction(connection, mintTx, [treasury], { commitment: "confirmed" });
      console.log(`[solana] Vault topped-up with ${VAULT_TOPUP_USDC} USDC (was ${vaultBalance.toFixed(4)} USDC)`);
    }

    // ── Step 4: Ensure user ATA exists (treasury pays for ATA rent) ──────
    const userATA = await getOrCreateAssociatedTokenAccount(
      connection,
      treasury,        // payer for ATA rent
      mint,
      recipient,
    );

    // ── Step 5: Vault → User transfer (vault signs) ───────────────────────
    const atomicAmount = Math.round(amountUsdc * Math.pow(10, decimals));
    const tx = new Transaction().add(
      createTransferInstruction(
        vaultATA.address,
        userATA.address,
        vault.publicKey,
        atomicAmount,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [vault], { commitment: "confirmed" });

    return {
      success: true,
      tx_signature: sig,
      amount_usdc: amountUsdc,
      wallet_address: walletAddress,
      is_simulated: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      tx_signature: null,
      amount_usdc: amountUsdc,
      wallet_address: walletAddress,
      is_simulated: false,
      error: message,
    };
  }
}

/**
 * Transfer USDC from the JaIre escrow vault back to a user wallet.
 * Used during checkout to refund excess escrow.
 */
export async function vaultToUserTransfer(
  userAddress: string,
  amountUsdc: number,
  mintAddress: string = DEFAULT_TEST_MINT,
  memo?: string,
): Promise<FundResult> {
  try {
    const connection = getSolanaConnection();
    const vault = getVaultKeypair();
    const treasury = getTreasuryKeypair(); // pays for ATA creation if needed
    const mint = new PublicKey(mintAddress);
    const recipient = new PublicKey(userAddress);

    const mintInfo = await getMint(connection, mint);
    const atomicAmount = Math.round(amountUsdc * Math.pow(10, mintInfo.decimals));
    if (atomicAmount === 0) {
      return { success: true, tx_signature: null, amount_usdc: 0, wallet_address: userAddress, is_simulated: false };
    }

    const fromATA = await getOrCreateAssociatedTokenAccount(
      connection, treasury, mint, vault.publicKey,
    );
    const toATA = await getOrCreateAssociatedTokenAccount(
      connection, treasury, mint, recipient,
    );

    const effectiveMemo = memo ?? `JAIRE|SETTLE|${amountUsdc}USDC|${userAddress.slice(0, 8)}`;
    const tx = new Transaction()
      .add(createTransferInstruction(fromATA.address, toATA.address, vault.publicKey, atomicAmount, [], TOKEN_PROGRAM_ID))
      .add(buildMemoInstruction(effectiveMemo));

    const sig = await sendAndConfirmTransaction(connection, tx, [vault, treasury], { commitment: "confirmed" });

    return { success: true, tx_signature: sig, amount_usdc: amountUsdc, wallet_address: userAddress, is_simulated: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, tx_signature: null, amount_usdc: amountUsdc, wallet_address: userAddress, is_simulated: false, error: message };
  }
}

// ── Co-sign USDC transfer from user wallet to escrow ──────────────────────

export interface TransferResult {
  success: boolean;
  tx_signature: string | null;
  from_address: string;
  to_address: string;
  amount_usdc: number;
  is_simulated: boolean;
  error?: string;
}

/**
 * Sign and submit a USDC transfer from a user's derived devnet keypair.
 *
 * DEVNET / SIMULATION ONLY: In this mode the server derives the full keypair
 * from the node factor key. On mainnet, replace this with a TSS co-sign call.
 */
export async function signUserUSDCTransfer(
  verifierId: string,
  toAddress: string,
  amountUsdc: number,
  mintAddress: string = DEFAULT_TEST_MINT,
  isSimulated: boolean = false,
  memo?: string,
): Promise<TransferResult> {
  const userKeypair = deriveUserDevnetKeypair(verifierId);
  const fromAddress = userKeypair.publicKey.toBase58();

  if (isSimulated) {
    return {
      success: true,
      tx_signature: `SIMULATED-TRANSFER-${fromAddress.slice(0, 8).toUpperCase()}`,
      from_address: fromAddress,
      to_address: toAddress,
      amount_usdc: amountUsdc,
      is_simulated: true,
    };
  }

  try {
    const connection = getSolanaConnection();
    const treasury = getTreasuryKeypair();
    const mint = new PublicKey(mintAddress);
    const fromPubkey = userKeypair.publicKey;
    const toPubkey = new PublicKey(toAddress);

    const mintInfo = await getMint(connection, mint);
    const atomicAmount = Math.round(amountUsdc * Math.pow(10, mintInfo.decimals));

    const fromATA = await getOrCreateAssociatedTokenAccount(
      connection,
      treasury,
      mint,
      fromPubkey,
    );

    const toATA = await getOrCreateAssociatedTokenAccount(
      connection,
      treasury,
      mint,
      toPubkey,
    );

    const effectiveMemo = memo ?? `JAIRE|ESCROW|${amountUsdc}USDC|${fromAddress.slice(0, 8)}→${toAddress.slice(0, 8)}`;
    const tx = new Transaction()
      .add(createTransferInstruction(fromATA.address, toATA.address, fromPubkey, atomicAmount, [], TOKEN_PROGRAM_ID))
      .add(buildMemoInstruction(effectiveMemo));

    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [userKeypair],
      { commitment: "confirmed" },
    );

    return {
      success: true,
      tx_signature: sig,
      from_address: fromAddress,
      to_address: toAddress,
      amount_usdc: amountUsdc,
      is_simulated: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      tx_signature: null,
      from_address: fromAddress,
      to_address: toAddress,
      amount_usdc: amountUsdc,
      is_simulated: false,
      error: message,
    };
  }
}
