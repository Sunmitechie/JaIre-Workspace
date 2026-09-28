import { Router } from "express";
import crypto, { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { payments, users, bookings, activityEvents, workspaces } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getRequiredSecretFromAny } from "../lib/secrets";
import { JAIRE_RATE, ngnToUsdc, generateRef } from "../lib/payment-utils";

const router = Router();

const PAYSTACK_SECRET = getRequiredSecretFromAny("PAYSTACK_SECRET_KEY", "PAYSTACK_TEST_API_KEY");
const PAYSTACK_BASE = "https://api.paystack.co";
const MPC_SIDECAR = "http://localhost:9000";

// JaIre earns the 0.5% spread between market and JaIre rate — hidden from user
const MARKET_RATE = 1600;       // NGN / USDC shown to user
const FX_SPREAD_PCT = 0.5;

// ── POST /api/payments/initiate ────────────────────────────────────────────
router.post("/payments/initiate", async (req, res) => {
  try {
    const { amount_ngn, user_email, user_wallet_address, booking_id, callback_url } = req.body as {
      amount_ngn: number;
      user_email: string;
      user_wallet_address?: string;
      booking_id?: string;
      callback_url?: string;
    };

    if (!amount_ngn || !user_email) {
      return res.status(400).json({ error: "amount_ngn and user_email are required" });
    }

    const reference = generateRef();
    const amountKobo = Math.round(amount_ngn * 100);
    const amountUsdc = ngnToUsdc(amount_ngn);

    // Hit real Paystack API
    const psRes = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user_email,
        amount: amountKobo,
        reference,
        currency: "NGN",
        callback_url: callback_url ?? `${process.env["APP_URL"] ?? ""}/dashboard`,
        metadata: {
          custom_fields: [
            { display_name: "Booking ID", variable_name: "booking_id", value: booking_id ?? "" },
            { display_name: "Wallet", variable_name: "wallet_address", value: user_wallet_address ?? "" },
          ],
        },
      }),
    });

    const psData = (await psRes.json()) as any;
    if (!psRes.ok || !psData.status) {
      return res.status(502).json({ error: psData.message ?? "Paystack error" });
    }

    // Record pending payment
    await db.insert(payments).values({
      bookingId: booking_id,
      userEmail: user_email,
      userWalletAddress: user_wallet_address,
      amountNgn: amount_ngn,
      amountUsdc,
      fxRate: JAIRE_RATE,
      fxSpreadPct: FX_SPREAD_PCT,
      reference,
      provider: "paystack",
      status: "pending",
    });

    // Upsert user if wallet address provided
    if (user_wallet_address) {
      await db
        .insert(users)
        .values({ email: user_email, walletAddress: user_wallet_address })
        .onConflictDoUpdate({
          target: users.email,
          set: { walletAddress: user_wallet_address, updatedAt: new Date() },
        });
    }

    res.json({
      reference,
      payment_url: psData.data.authorization_url,
      amount_ngn,
      amount_usdc: amountUsdc,
      fx_rate: MARKET_RATE, // show user market rate, not JaIre rate
      access_code: psData.data.access_code,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to initiate payment" });
  }
});

// ── GET /api/payments/verify/:reference ────────────────────────────────────
router.get("/payments/verify/:reference", async (req, res) => {
  const { reference } = req.params;
  try {
    const psRes = await fetch(`${PAYSTACK_BASE}/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    });
    const psData = (await psRes.json()) as any;
    if (!psRes.ok || !psData.status) {
      return res.status(502).json({ error: psData.message ?? "Paystack verification failed" });
    }

    const isPaid = psData.data.status === "success";
    if (isPaid) {
      const [payment] = await db.select().from(payments).where(eq(payments.reference, reference));
      if (payment && payment.status !== "success") {
        await db.update(payments).set({ status: "success", updatedAt: new Date() }).where(eq(payments.reference, reference));
        await processSuccessfulPayment(payment);
      }
    }

    res.json({
      reference,
      status: psData.data.status,
      amount_ngn: psData.data.amount / 100,
      paid: isPaid,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Verification failed" });
  }
});

// ── POST /api/payments/webhook ─────────────────────────────────────────────
// Paystack posts here on every charge.success event.
// app.ts mounts express.raw() for this path so req.body is a raw Buffer.
router.post("/payments/webhook", async (req, res) => {
  const signature = req.headers["x-paystack-signature"] as string;

  // req.body is a Buffer (from express.raw) — use it directly for HMAC
  const rawBody: Buffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify(req.body));

  const expected = crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(rawBody)
    .digest("hex");

  if (signature !== expected) {
    logger.warn("[webhook] Invalid Paystack signature — rejected");
    return res.status(400).json({ error: "Invalid signature" });
  }

  res.sendStatus(200); // Acknowledge immediately so Paystack doesn't retry

  const event = JSON.parse(rawBody.toString("utf8")) as any;

  try {
    if (event.event === "charge.success") {
      const { reference } = event.data as { reference: string };

      // Mark payment as success
      await db
        .update(payments)
        .set({ status: "success", updatedAt: new Date() })
        .where(eq(payments.reference, reference));

      const [payment] = await db.select().from(payments).where(eq(payments.reference, reference));

      if (payment && !payment.txSignature) {
        await processSuccessfulPayment(payment);
      }
    }
  } catch (err) {
    logger.error({ err }, "[webhook] Processing error");
  }
});

// ── GET /api/payments/status/:reference ────────────────────────────────────
// Checks DB first. If still pending, verifies directly with Paystack (handles
// the case where the webhook hasn't arrived yet — common in dev environments).
router.get("/payments/status/:reference", async (req, res) => {
  // Disable ALL caching — the client polls this; stale ETags produce silent 304s
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  const { reference } = req.params;
  try {
    const [payment] = await db.select().from(payments).where(eq(payments.reference, reference));
    if (!payment) return res.status(404).json({ error: "Payment not found" });

    // Already confirmed — just return it
    if (payment.status === "success") {
      return res.json(payment);
    }

    // Still pending: ask Paystack directly (webhook fallback)
    try {
      const psRes = await fetch(`${PAYSTACK_BASE}/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      });
      if (psRes.ok) {
        const psData = (await psRes.json()) as any;
        if (psData.data?.status === "success") {
          // Update DB atomically — only process if we're the first to flip it
          const updated = await db
            .update(payments)
            .set({ status: "success", updatedAt: new Date() })
            .where(eq(payments.reference, reference))
            .returning();

          const freshPayment = updated[0];
          if (freshPayment && !freshPayment.txSignature) {
            // Fire-and-forget the on-chain transfer; don't block the response
            processSuccessfulPayment(freshPayment).catch((e) =>
              logger.error({ err: e }, "[status] processSuccessfulPayment error")
            );
          }
          return res.json({ ...freshPayment, status: "success" });
        }
      }
    } catch (verifyErr) {
      // Paystack verify failed — just return what we have in DB
      logger.warn({ err: verifyErr }, "[status] Paystack verify failed");
    }

    res.json(payment);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/payments/recover-pending ─────────────────────────────────────
// Called when the wallet panel opens. Two recovery passes:
//  1. Pending in DB → verify with Paystack → if confirmed, run on-chain transfer
//  2. Success in DB but no tx_signature → on-chain transfer silently failed, retry
router.post("/payments/recover-pending", async (req, res) => {
  const { user_email } = req.body as { user_email?: string };
  if (!user_email) return res.status(400).json({ error: "user_email required" });

  try {
    let recovered = 0;

    // Pass 1: Pending payments — check Paystack and flip + transfer if confirmed
    const pending = await db
      .select()
      .from(payments)
      .where(and(eq(payments.userEmail, user_email), eq(payments.status, "pending")));

    for (const payment of pending) {
      try {
        const psRes = await fetch(`${PAYSTACK_BASE}/transaction/verify/${payment.reference}`, {
          headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
        });
        if (!psRes.ok) continue;
        const psData = (await psRes.json()) as any;
        if (psData.data?.status !== "success") continue;

        const updated = await db
          .update(payments)
          .set({ status: "success", updatedAt: new Date() })
          .where(and(eq(payments.reference, payment.reference), eq(payments.status, "pending")))
          .returning();

        if (updated[0] && !updated[0].txSignature) {
          processSuccessfulPayment(updated[0]).catch((e) =>
            logger.error({ err: e }, "[recover] processSuccessfulPayment error")
          );
          recovered++;
        }
      } catch (e) {
        logger.warn({ err: e, reference: payment.reference }, "[recover] Failed to verify payment");
      }
    }

    // Pass 2: Success in DB but tx_signature is null → on-chain transfer failed, retry
    const allSuccess = await db
      .select()
      .from(payments)
      .where(and(eq(payments.userEmail, user_email), eq(payments.status, "success")));

    const noTxPayments = allSuccess.filter((p) => !p.txSignature);

    for (const payment of noTxPayments) {
      try {
        logger.info({ reference: payment.reference }, "[recover] Retrying failed on-chain transfer");
        processSuccessfulPayment(payment).catch((e) =>
          logger.error({ err: e, reference: payment.reference }, "[recover-pass2] processSuccessfulPayment error")
        );
        recovered++;
      } catch (e) {
        logger.warn({ err: e, reference: payment.reference }, "[recover] Retry failed for payment");
      }
    }

    res.json({ checked: pending.length + noTxPayments.length, recovered });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/payments/book-with-balance ───────────────────────────────────
// Smart booking: use wallet USDC if sufficient, else fall back to Paystack.
// Returns { method:"wallet"|"paystack", booking_id, ... }
router.post("/payments/book-with-balance", async (req, res) => {
  try {
    const { workspace_id, planned_duration_hours, user_email, user_name, workspace_fallback, user_wallet_address: requestWalletAddress } = req.body as {
      workspace_id: string;
      planned_duration_hours: number;
      user_email: string;
      user_name?: string;
      user_wallet_address?: string;
      workspace_fallback?: { name: string; hourly_rate_ngn: number; hourly_rate_usdc: number };
    };

    if (!workspace_id || !planned_duration_hours || !user_email) {
      return res.status(400).json({ error: "workspace_id, planned_duration_hours and user_email are required" });
    }

    // Look up workspace from DB — fall back to Baire's hardcoded data if not yet seeded
    const [dbWs] = await db.select().from(workspaces).where(eq(workspaces.id, workspace_id));
    const ws = dbWs ?? (workspace_fallback
      ? {
          id: workspace_id,
          name: workspace_fallback.name,
          hourlyRateNgn: workspace_fallback.hourly_rate_ngn,
          hourlyRateUsdc: workspace_fallback.hourly_rate_usdc,
        }
      : null);

    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    const escrowUsdc = ws.hourlyRateUsdc * planned_duration_hours;
    const amountNgn = ws.hourlyRateNgn * planned_duration_hours;

    // Look up user wallet + verifier_id — try email first, then wallet address
    const [userByEmail] = await db.select().from(users).where(eq(users.email, user_email));
    let resolvedUser = userByEmail;
    if (!resolvedUser?.verifierId && requestWalletAddress) {
      const [userByWallet] = await db.select().from(users).where(eq(users.walletAddress, requestWalletAddress));
      resolvedUser = userByWallet ?? resolvedUser;
    }
    // Use DB wallet address, falling back to the address provided in the request
    const userWalletAddress = resolvedUser?.walletAddress ?? requestWalletAddress;
    const verifierId = resolvedUser?.verifierId;

    // Check wallet balance
    let walletBalanceUsdc = 0;
    if (userWalletAddress) {
      try {
        const balRes = await fetch(`${MPC_SIDECAR}/mpc/balance/${userWalletAddress}`);
        if (balRes.ok) {
          const balData = (await balRes.json()) as { usdc_balance?: number };
          walletBalanceUsdc = balData.usdc_balance ?? 0;
        }
      } catch { /* fall through to Paystack */ }
    }

    // Create booking in pending status
    const bookingId = randomUUID();
    await db.insert(bookings).values({
      id: bookingId,
      workspaceId: workspace_id,
      userId: user_email ?? "guest",
      userName: user_name ?? "Guest",
      userEmail: user_email,
      status: "pending",
      plannedDurationHours: planned_duration_hours,
      escrowAmountUsdc: escrowUsdc,
      paymentMethod: "paystack",
      ngnAmountPaid: amountNgn,
    });

    // Path A: wallet has enough USDC → escrow directly
    if (walletBalanceUsdc >= escrowUsdc && verifierId) {
      logger.info({ walletBalanceUsdc, escrowUsdc }, "[book-with-balance] Wallet has sufficient USDC for escrow");

      const escrowRes = await fetch(`${MPC_SIDECAR}/mpc/internal/escrow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verifier_id: verifierId,
          amount_usdc: escrowUsdc,
          memo: `JAIRE|ESCROW|${bookingId.slice(0, 8)}|${escrowUsdc}USDC|${user_email}`,
        }),
      });

      if (!escrowRes.ok) {
        const errText = await escrowRes.text();
        logger.error({ errText }, "[book-with-balance] Escrow failed");
        // Fall through to Paystack if escrow fails
      } else {
        const escrowData = (await escrowRes.json()) as { tx_signature?: string };
        const escrowTx = escrowData.tx_signature ?? null;

        // Funds locked in vault — booking is CONFIRMED, waiting for physical scan-in.
        // Do NOT set checkInTime here; the timer only starts on QR check-in.
        await db.update(bookings).set({
          status: "confirmed",
          escrowTxSignature: escrowTx,
          paymentMethod: "usdc_wallet",
        }).where(eq(bookings.id, bookingId));

        // Log the payment / escrow event
        await db.insert(activityEvents).values({
          id: randomUUID(),
          eventType: "payment",
          workspaceId: workspace_id,
          workspaceName: ws.name,
          userId: user_email,
          userName: user_name ?? "Guest",
          amountUsdc: escrowUsdc,
          amountNgn: amountNgn,
        });

        logger.info({ bookingId, escrowTx }, "[book-with-balance] Booking confirmed using wallet funds");

        return res.json({
          method: "wallet",
          booking_id: bookingId,
          workspace_name: ws.name,
          booking_status: "confirmed",
          escrow_tx: escrowTx,
          solana_explorer_url: escrowTx ? `https://explorer.solana.com/tx/${escrowTx}?cluster=devnet` : null,
          amount_usdc: escrowUsdc,
          amount_ngn: amountNgn,
          wallet_balance_usdc: walletBalanceUsdc,
        });
      }
    }

    // Path B: insufficient balance or escrow failed → Paystack top-up (shortfall only)
    // Charge only the deficit so the user's existing USDC is used towards the booking
    const shortfallUsdc = Math.max(0, escrowUsdc - walletBalanceUsdc);
    // If escrow failed with sufficient balance, fall back to charging the full amount
    const chargeNgn = shortfallUsdc > 0 ? Math.ceil(shortfallUsdc * JAIRE_RATE) : amountNgn;
    const chargeUsdc = shortfallUsdc > 0 ? shortfallUsdc : ngnToUsdc(amountNgn);
    const shortfallNgn = Math.round(shortfallUsdc * MARKET_RATE);

    const reference = generateRef();
    const amountKobo = Math.round(chargeNgn * 100);

    const appUrl = process.env["APP_URL"] ?? `https://${process.env["REPLIT_DEV_DOMAIN"] ?? "localhost"}`;

    const psRes = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user_email,
        amount: amountKobo,
        reference,
        currency: "NGN",
        callback_url: `${appUrl}/session/${bookingId}`,
        metadata: {
          booking_id: bookingId,
          wallet_address: userWalletAddress ?? "",
          custom_fields: [
            { display_name: "Booking ID", variable_name: "booking_id", value: bookingId },
            { display_name: "Wallet", variable_name: "wallet_address", value: userWalletAddress ?? "" },
          ],
        },
      }),
    });

    const psData = (await psRes.json()) as any;
    if (!psRes.ok || !psData.status) {
      return res.status(502).json({ error: psData.message ?? "Paystack error" });
    }

    // Record payment — amounts reflect what Paystack actually charges (shortfall only)
    const amountUsdc = chargeUsdc;
    await db.insert(payments).values({
      bookingId,
      userEmail: user_email,
      userWalletAddress: userWalletAddress,
      amountNgn: chargeNgn,
      amountUsdc: chargeUsdc,
      fxRate: JAIRE_RATE,
      fxSpreadPct: FX_SPREAD_PCT,
      reference,
      provider: "paystack",
      status: "pending",
    });

    return res.json({
      method: "paystack",
      booking_id: bookingId,
      workspace_name: ws.name,
      booking_status: "pending",
      paystack_reference: reference,
      paystack_url: psData.data.authorization_url,
      paystack_access_code: psData.data.access_code,
      total_ngn: amountNgn,               // full booking cost shown to user
      total_usdc: escrowUsdc,             // full USDC that will be escrowed
      charge_ngn: chargeNgn,             // what Paystack actually charges (shortfall)
      charge_usdc: chargeUsdc,           // USDC that will be credited from this payment
      wallet_balance_usdc: walletBalanceUsdc,
      shortfall_ngn: shortfallNgn,
    });
  } catch (err: any) {
    logger.error({ err }, "[book-with-balance] error");
    res.status(500).json({ error: err.message ?? "Booking failed" });
  }
});

// ── Vault address resolver ──────────────────────────────────────────────────
// Tries JAIRE_VAULT_ADDRESS env first; falls back to asking the MPC sidecar.
let _cachedVaultAddress: string | null = null;

async function getVaultAddress(): Promise<string | null> {
  const envAddr = process.env["JAIRE_VAULT_ADDRESS"];
  if (envAddr) return envAddr;
  if (_cachedVaultAddress) return _cachedVaultAddress;
  try {
    const res = await fetch(`${MPC_SIDECAR}/mpc/vault-address`);
    if (res.ok) {
      const data = (await res.json()) as { vault_address?: string };
      if (data.vault_address) {
        _cachedVaultAddress = data.vault_address;
        return _cachedVaultAddress;
      }
    }
  } catch (err) {
    logger.error({ err }, "[payment] Could not fetch vault address from sidecar");
  }
  return null;
}

// ── Core payment processor ─────────────────────────────────────────────────
// Called after Paystack confirms an NGN payment. Two clear flows:
//
//  No booking (wallet top-up):
//    Treasury mints USDC → User wallet
//    User can then book separately.
//
//  Booking-linked payment:
//    Step 1 — Exchange: Treasury mints USDC equivalent into JaIre vault
//              (JAIRE_VAULT_ADDRESS from secrets). This is the NGN→USDC
//              conversion. One atomic transaction.
//    Step 2 — Booking confirmed: vault holds the escrow until checkout.
//    No intermediate user-wallet step. Clean and atomic.
//
//  At checkout: vault pays 85% to org wallet, refunds excess to user.
//
// Booking is ONLY confirmed after escrow lands in vault.
async function processSuccessfulPayment(payment: typeof payments.$inferSelect) {
  const { userWalletAddress, amountUsdc, reference, bookingId, userEmail } = payment;

  // ── No booking linked: wallet top-up only ────────────────────────────────
  // User paid NGN to top up their USDC wallet. Send USDC directly to their wallet.
  if (!bookingId) {
    if (!userWalletAddress) {
      logger.info({ reference }, "[payment] Top-up with no wallet — nothing to do");
      return;
    }
    logger.info({ amountUsdc, walletAddress: userWalletAddress.slice(0, 8) }, "[payment] Top-up: Treasury mints USDC to user wallet");
    const fundRes = await fetch(`${MPC_SIDECAR}/mpc/fund-by-address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: userWalletAddress,
        usdc_amount: amountUsdc,
        reference,
        memo: `JAIRE|TOPUP|${reference}|${amountUsdc}USDC`,
      }),
    });
    if (fundRes.ok) {
      const fd = (await fundRes.json()) as { tx_signature?: string | null };
      await db.update(payments).set({ txSignature: fd.tx_signature ?? null, updatedAt: new Date() }).where(eq(payments.reference, reference));
      logger.info({ txSignature: fd.tx_signature }, "[payment] Top-up confirmed");
    } else {
      logger.error({ response: await fundRes.text() }, "[payment] Top-up failed");
    }
    return;
  }

  // ── Booking-linked payment: exchange NGN → USDC → user wallet ───────────
  // The exchange (mint) lands in the user's invisible wallet.
  // At QR check-in, the Anchor program transfers user wallet → PDA escrow.
  // This keeps the exchange and escrow as two distinct on-chain steps.
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) {
    logger.warn({ bookingId }, "[payment] Booking not found");
    return;
  }
  const escrowUsdc = booking.escrowAmountUsdc ?? amountUsdc;

  if (!userWalletAddress) {
    logger.error({ bookingId }, "[payment] No wallet address for booking — cannot mint USDC");
    return;
  }

  logger.info({
    escrowUsdc,
    walletPrefix: userWalletAddress.slice(0, 8),
    bookingPrefix: bookingId.slice(0, 8),
    reference,
  }, "[payment] Exchange: Treasury mints USDC to user wallet");

  const exchangeRes = await fetch(`${MPC_SIDECAR}/mpc/fund-by-address`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet_address: userWalletAddress,
      usdc_amount: escrowUsdc,
      reference,
      memo: `JAIRE|TOPUP|${bookingId.slice(0, 8)}|${escrowUsdc}USDC`,
    }),
  });

  if (!exchangeRes.ok) {
    logger.error({ bookingId, response: await exchangeRes.text() }, "[payment] Exchange→user wallet FAILED");
    return;
  }

  const exchangeData = (await exchangeRes.json()) as { tx_signature?: string | null };
  const topupTx = exchangeData.tx_signature ?? null;

  // Record the top-up tx; booking stays "pending" until QR check-in triggers the PDA escrow
  await db.update(payments)
    .set({ txSignature: topupTx, updatedAt: new Date() })
    .where(eq(payments.reference, reference));

  await db.update(bookings).set({
    status: "confirmed",
    ngnAmountPaid: booking.ngnAmountPaid ?? payment.amountNgn,
    paymentMethod: "paystack",
  }).where(eq(bookings.id, bookingId));

  logger.info({
    bookingPrefix: bookingId.slice(0, 8),
    escrowUsdc,
    walletPrefix: userWalletAddress.slice(0, 8),
    txSignature: topupTx,
  }, "[payment] Booking confirmed with user-wallet USDC for escrow");
}

export default router;
