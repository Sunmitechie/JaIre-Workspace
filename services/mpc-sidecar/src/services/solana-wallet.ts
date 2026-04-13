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
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
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

export function getTreasuryKeypair(): Keypair {
  if (_treasury) return _treasury;

  const raw = process.env.JAIRE_TREASURY_PRIVATE_KEY;
  if (!raw) throw new Error("JAIRE_TREASURY_PRIVATE_KEY not set");

  let bytes: Uint8Array;
  if (/^[0-9a-fA-F]{128}$/.test(raw)) {
    bytes = Uint8Array.from(Buffer.from(raw, "hex"));
  } else if (raw.startsWith("[")) {
    bytes = Uint8Array.from(JSON.parse(raw) as number[]);
  } else {
    bytes = bs58.decode(raw);
  }

  _treasury = Keypair.fromSecretKey(bytes);
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

    const mintInfo = await getMint(connection, mint);
    const atomicAmount = Math.round(amountUsdc * Math.pow(10, mintInfo.decimals));

    const fromATA = await getOrCreateAssociatedTokenAccount(
      connection,
      treasury,
      mint,
      treasury.publicKey,
    );

    const toATA = await getOrCreateAssociatedTokenAccount(
      connection,
      treasury,
      mint,
      recipient,
    );

    const tx = new Transaction().add(
      createTransferInstruction(
        fromATA.address,
        toATA.address,
        treasury.publicKey,
        atomicAmount,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );

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

// ── Vault keypair (escrow holder) ─────────────────────────────────────────

let _vault: Keypair | null = null;

export function getVaultKeypair(): Keypair {
  if (_vault) return _vault;
  const raw = process.env.JAIRE_VAULT_PRIVATE_KEY;
  if (!raw) throw new Error("JAIRE_VAULT_PRIVATE_KEY not set");
  let bytes: Uint8Array;
  if (/^[0-9a-fA-F]{128}$/.test(raw)) {
    bytes = Uint8Array.from(Buffer.from(raw, "hex"));
  } else if (raw.startsWith("[")) {
    bytes = Uint8Array.from(JSON.parse(raw) as number[]);
  } else {
    bytes = bs58.decode(raw);
  }
  _vault = Keypair.fromSecretKey(bytes);
  return _vault;
}

/**
 * Transfer USDC from the JaIre escrow vault back to a user wallet.
 * Used during checkout to refund excess escrow.
 */
export async function vaultToUserTransfer(
  userAddress: string,
  amountUsdc: number,
  mintAddress: string = DEFAULT_TEST_MINT,
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

    const tx = new Transaction().add(
      createTransferInstruction(
        fromATA.address, toATA.address,
        vault.publicKey, atomicAmount, [], TOKEN_PROGRAM_ID,
      ),
    );

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

    const tx = new Transaction().add(
      createTransferInstruction(
        fromATA.address,
        toATA.address,
        fromPubkey,
        atomicAmount,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );

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
