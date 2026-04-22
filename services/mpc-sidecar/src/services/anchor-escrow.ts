/**
 * JaIre Escrow Service — Vault-Backed Custodial Implementation
 *
 * Implements the per-second billing escrow flow:
 *   1. initialize_escrow  (QR check-in)
 *      User's MPC wallet → JaIre vault USDC account
 *      Tagged with memo: JAIRE|ESCROW|{booking_id}|{amount}USDC
 *      User's derived keypair signs; treasury pays gas.
 *
 *   2. settle_session  (QR check-out — treasury-signed atomic tx)
 *      Vault → org wallet        (85 % of billed time)
 *      Vault → user wallet       (unused deposit refund)
 *      15 % stays in vault       (JaIre revenue — no instruction needed)
 *
 * Escrow PDA address derivation follows the deployed Anchor program seeds:
 *   seeds = [b"escrow", user_wallet, booking_id_bytes]
 *   program_id = Gq5D4wB5yaAyK4M5mP82cJ1JnZJ2qypuZ7z5DjJ9WzGJ
 * These are logged for reference; the PDA is used as the custodial escrow owner
 * once the on-chain program is live. Until then, the vault serves as custodian.
 */

import {
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  getSolanaConnection,
  getTreasuryKeypair,
  getVaultKeypair,
} from "./solana-wallet.js";
import { deriveUserDevnetKeypair } from "./mpc-service.js";
import { buildMemoInstruction } from "./memo.js";

// ── Constants ──────────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("Gq5D4wB5yaAyK4M5mP82cJ1JnZJ2qypuZ7z5DjJ9WzGJ");
const DEFAULT_MINT = process.env.JAIRE_TEST_MINT ?? "7egxbd4d6tsPsRKJU8v74PKFnis4YKhbQgKX9HDCpR8S";

const HOST_SHARE_BPS    = 8_500; // 85 %
const TREASURY_SHARE_BPS = 1_500; // 15 % stays in vault — no transfer
const BPS_DENOMINATOR   = 10_000;
const DUST_THRESHOLD    = 1_000; // skip refunds smaller than 0.001 USDC (1000 atomic)

// ── PDA derivation helpers (matching Anchor program seeds) ─────────────────

/** Convert booking UUID to 8-byte buffer — matches Rust `booking_id: [u8; 8]`. */
export function bookingIdToBytes(bookingId: string): Buffer {
  const hex = bookingId.replace(/-/g, "").slice(0, 16);
  return Buffer.from(hex, "hex");
}

/** Derive session state PDA — seeds: [b"session", user_wallet, booking_id_bytes]. */
export function deriveSessionPDA(userWallet: PublicKey, bookingIdBytes: Buffer): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("session"), userWallet.toBuffer(), bookingIdBytes],
    PROGRAM_ID,
  );
  return pda;
}

/** Derive escrow token account PDA — seeds: [b"escrow", user_wallet, booking_id_bytes]. */
export function deriveEscrowPDA(userWallet: PublicKey, bookingIdBytes: Buffer): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), userWallet.toBuffer(), bookingIdBytes],
    PROGRAM_ID,
  );
  return pda;
}

// ── initialize_escrow ──────────────────────────────────────────────────────

export interface EscrowInitResult {
  success: boolean;
  tx_signature: string | null;
  escrow_pda: string;          // on-chain PDA address (logged for reference)
  session_pda: string;
  vault_usdc_account: string;  // actual custodial destination until program deployed
  user_wallet: string;
  deposit_usdc: number;
  planned_seconds: number;
  error?: string;
}

/**
 * Open session escrow at QR check-in.
 *
 * Transfers the user's pre-paid USDC from their MPC wallet to the JaIre vault.
 * The user's MPC-derived keypair signs the transfer (treasury pays Solana gas).
 *
 * @param verifierId        Web3Auth verifier ID (derives user keypair in MPC sidecar)
 * @param userWalletAddress User's on-chain Solana address
 * @param bookingId         Full UUID of the booking
 * @param plannedSeconds    Pre-paid session duration (seconds)
 * @param escrowUsdcAmount  USDC to lock — computed from rate × planned hours
 */
export async function initializeEscrow(
  verifierId: string,
  userWalletAddress: string,
  bookingId: string,
  plannedSeconds: number,
  escrowUsdcAmount: number,
  mintAddress: string = DEFAULT_MINT,
): Promise<EscrowInitResult> {
  const connection = getSolanaConnection();
  const treasury   = getTreasuryKeypair();
  const vault      = getVaultKeypair();
  const userKeypair = deriveUserDevnetKeypair(verifierId);

  const mint       = new PublicKey(mintAddress);
  const userWallet = new PublicKey(userWalletAddress);
  const bookingIdBytes = bookingIdToBytes(bookingId);

  // Compute reference PDA addresses (for on-chain indexing when program goes live)
  const escrowPDA  = deriveEscrowPDA(userWallet, bookingIdBytes);
  const sessionPDA = deriveSessionPDA(userWallet, bookingIdBytes);

  try {
    const mintInfo   = await getMint(connection, mint);
    const atomicAmt  = Math.round(escrowUsdcAmount * Math.pow(10, mintInfo.decimals));

    // User's source ATA (treasury pays for creation if it doesn't exist yet)
    const userATA = await getOrCreateAssociatedTokenAccount(
      connection, treasury, mint, userWallet,
    );

    // Vault's USDC token account (custodial escrow destination)
    const vaultATA = await getOrCreateAssociatedTokenAccount(
      connection, treasury, mint, vault.publicKey,
    );

    const memo = `JAIRE|ESCROW|${bookingId.slice(0, 8)}|${escrowUsdcAmount}USDC|${plannedSeconds}s`;

    const tx = new Transaction()
      .add(
        createTransferInstruction(
          userATA.address,   // source: user's USDC token account
          vaultATA.address,  // destination: vault (custodial escrow)
          userWallet,        // authority: user wallet owns their ATA
          atomicAmt,
          [],
          TOKEN_PROGRAM_ID,
        ),
      )
      .add(buildMemoInstruction(memo));

    // treasury = fee payer; userKeypair = transfer authority (user signs lock-in)
    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [treasury, userKeypair],
      { commitment: "confirmed" },
    );

    console.log(
      `[escrow/init] ✓ ${escrowUsdcAmount} USDC locked ` +
      `user=${userWalletAddress.slice(0, 8)}… booking=${bookingId.slice(0, 8)} ` +
      `escrow_pda=${escrowPDA.toBase58().slice(0, 8)}… tx=${sig}`,
    );

    return {
      success:            true,
      tx_signature:       sig,
      escrow_pda:         escrowPDA.toBase58(),
      session_pda:        sessionPDA.toBase58(),
      vault_usdc_account: vaultATA.address.toBase58(),
      user_wallet:        userWalletAddress,
      deposit_usdc:       escrowUsdcAmount,
      planned_seconds:    plannedSeconds,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[escrow/init] FAILED booking=${bookingId.slice(0, 8)}: ${message}`);
    return {
      success:            false,
      tx_signature:       null,
      escrow_pda:         escrowPDA.toBase58(),
      session_pda:        sessionPDA.toBase58(),
      vault_usdc_account: "",
      user_wallet:        userWalletAddress,
      deposit_usdc:       escrowUsdcAmount,
      planned_seconds:    plannedSeconds,
      error:              message,
    };
  }
}

// ── settle_session ─────────────────────────────────────────────────────────

export interface EscrowSettleResult {
  success:               boolean;
  tx_signature:          string | null;
  billable_seconds:      number;
  time_cost_usdc:        number;
  host_amount_usdc:      number;  // 85 % → org wallet
  treasury_amount_usdc:  number;  // 15 % stays in vault
  refund_usdc:           number;  // unused deposit → user wallet
  error?:                string;
}

/**
 * Settle and close session escrow at QR check-out.
 *
 * Atomic transaction (treasury-signed):
 *   1. Vault → org wallet       (85 % of billed time cost)
 *   2. Vault → user wallet      (unused deposit refund, if any)
 *   3. 15 % stays in vault      (JaIre revenue — no instruction required)
 *
 * @param userWalletAddress   User's on-chain Solana address
 * @param bookingId           Full UUID of the booking
 * @param depositUsdcAmount   USDC locked at check-in
 * @param plannedSeconds      Pre-paid duration
 * @param durationSeconds     Actual session duration (from MQTT timestamps)
 * @param orgWalletAddress    Org owner's wallet (receives 85 %)
 */
export async function settleSession(
  userWalletAddress: string,
  bookingId:         string,
  depositUsdcAmount: number,
  plannedSeconds:    number,
  durationSeconds:   number,
  orgWalletAddress:  string,
  mintAddress:       string = DEFAULT_MINT,
): Promise<EscrowSettleResult> {
  const connection = getSolanaConnection();
  const treasury   = getTreasuryKeypair();
  const vault      = getVaultKeypair();

  const mint       = new PublicKey(mintAddress);
  const userWallet = new PublicKey(userWalletAddress);
  const orgWallet  = new PublicKey(orgWalletAddress);

  try {
    const mintInfo    = await getMint(connection, mint);
    const decimals    = mintInfo.decimals;
    const toUsdc      = (a: number) => parseFloat((a / Math.pow(10, decimals)).toFixed(decimals));
    const depositAmt  = Math.round(depositUsdcAmount * Math.pow(10, decimals));

    // ── Per-second billing ─────────────────────────────────────────────────
    const billableSeconds = Math.min(durationSeconds, plannedSeconds);
    const timeCostAmt     = plannedSeconds > 0
      ? Math.floor((depositAmt * billableSeconds) / plannedSeconds)
      : depositAmt;
    const cappedCost      = Math.min(timeCostAmt, depositAmt);

    const hostAmt    = Math.floor((cappedCost * HOST_SHARE_BPS)    / BPS_DENOMINATOR);
    const refundAmt  = depositAmt - cappedCost;
    const refundSend = refundAmt >= DUST_THRESHOLD ? refundAmt : 0;
    // treasury 15 % = cappedCost − hostAmt, stays in vault automatically
    const treasuryAmt = cappedCost - hostAmt;

    console.log(
      `[escrow/settle] booking=${bookingId.slice(0, 8)} ` +
      `billed=${billableSeconds}s cost=${toUsdc(cappedCost)}USDC ` +
      `org=${toUsdc(hostAmt)} treasury=${toUsdc(treasuryAmt)} refund=${toUsdc(refundSend)}`,
    );

    // ── Build atomic settlement transaction ───────────────────────────────
    const vaultATA = await getOrCreateAssociatedTokenAccount(
      connection, treasury, mint, vault.publicKey,
    );
    const orgATA = await getOrCreateAssociatedTokenAccount(
      connection, treasury, mint, orgWallet,
    );
    const userATA = await getOrCreateAssociatedTokenAccount(
      connection, treasury, mint, userWallet,
    );

    const memo = `JAIRE|SETTLE|${bookingId.slice(0, 8)}|${billableSeconds}s|org${toUsdc(hostAmt)}|ref${toUsdc(refundSend)}`;
    const tx   = new Transaction();

    // 1. Vault → org (85 %)
    if (hostAmt > 0) {
      tx.add(createTransferInstruction(
        vaultATA.address, orgATA.address,
        vault.publicKey,  // vault authority signs
        hostAmt, [], TOKEN_PROGRAM_ID,
      ));
    }

    // 2. Vault → user (unused deposit refund)
    if (refundSend > 0) {
      tx.add(createTransferInstruction(
        vaultATA.address, userATA.address,
        vault.publicKey,
        refundSend, [], TOKEN_PROGRAM_ID,
      ));
    }

    tx.add(buildMemoInstruction(memo));

    // treasury pays gas; vault (controlled by vault keypair) authorises transfers
    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [treasury, vault],
      { commitment: "confirmed" },
    );

    console.log(
      `[escrow/settle] ✓ booking=${bookingId.slice(0, 8)} ` +
      `org+${toUsdc(hostAmt)} ref+${toUsdc(refundSend)} treasury_ret=${toUsdc(treasuryAmt)} ` +
      `tx=${sig}`,
    );

    return {
      success:              true,
      tx_signature:         sig,
      billable_seconds:     billableSeconds,
      time_cost_usdc:       toUsdc(cappedCost),
      host_amount_usdc:     toUsdc(hostAmt),
      treasury_amount_usdc: toUsdc(treasuryAmt),
      refund_usdc:          toUsdc(refundSend),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[escrow/settle] FAILED booking=${bookingId.slice(0, 8)}: ${message}`);
    return {
      success:              false,
      tx_signature:         null,
      billable_seconds:     0,
      time_cost_usdc:       0,
      host_amount_usdc:     0,
      treasury_amount_usdc: 0,
      refund_usdc:          0,
      error:                message,
    };
  }
}
