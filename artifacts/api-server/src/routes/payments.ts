import { Router } from "express";
import crypto, { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { payments, users, bookings, activityEvents, workspaces } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

const router = Router();

const PAYSTACK_SECRET = (process.env["PAYSTACK_SECRET_KEY"] ?? process.env["PAYSTACK_TEST_API_KEY"])!;
const PAYSTACK_BASE = "https://api.paystack.co";
const MPC_SIDECAR = "http://localhost:9000";

// JaIre earns the 0.5% spread between market and JaIre rate — hidden from user
const MARKET_RATE = 1600;       // NGN / USDC shown to user
const JAIRE_RATE = 1608;        // actual rate used (1600 × 1.005)
const FX_SPREAD_PCT = 0.5;

function ngnToUsdc(ngn: number): number {
  return parseFloat((ngn / JAIRE_RATE).toFixed(6));
}

function generateRef(): string {
  return `JI-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

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
    console.warn("[webhook] Invalid Paystack signature — rejected");
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
    console.error("[webhook] Processing error:", err);
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
              console.error("[status] processSuccessfulPayment error:", e)
            );
          }
          return res.json({ ...freshPayment, status: "success" });
        }
      }
    } catch (verifyErr) {
      // Paystack verify failed — just return what we have in DB
      console.warn("[status] Paystack verify failed:", verifyErr);
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
            console.error("[recover] processSuccessfulPayment error:", e)
          );
          recovered++;
        }
      } catch (e) {
        console.warn(`[recover] Failed to verify ${payment.reference}:`, e);
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
        console.log(`[recover] Retrying failed on-chain transfer for ${payment.reference}`);
        processSuccessfulPayment(payment).catch((e) =>
          console.error("[recover-pass2] processSuccessfulPayment error:", e)
        );
        recovered++;
      } catch (e) {
        console.warn(`[recover] Retry failed for ${payment.reference}:`, e);
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
      console.log(`[book-with-balance] Wallet has ${walletBalanceUsdc} USDC — enough for ${escrowUsdc} USDC escrow`);

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
        console.error(`[book-with-balance] Escrow failed: ${errText}`);
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

        console.log(`[book-with-balance] Booking ${bookingId} confirmed (wallet), escrow tx: ${escrowTx}`);

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
    console.error("[book-with-balance] error:", err);
    res.status(500).json({ error: err.message ?? "Booking failed" });
  }
});

// ── Core payment processor ─────────────────────────────────────────────────
// Called after webhook confirms payment. Does two on-chain steps:
// 1. Treasury → User wallet  (credit NGN payment as USDC — the exchange step)
// 2. User wallet → Vault     (escrow for linked booking)
//
// If the user has no wallet, the exchange still happens: JaIre's vault funds
// the escrow directly (Treasury → Vault), so no Paystack payment ever bypasses
// the NGN→USDC exchange from JaIre's reserves.
async function processSuccessfulPayment(payment: typeof payments.$inferSelect) {
  const { userWalletAddress, amountUsdc, reference, bookingId, userEmail } = payment;

  // ── No wallet address: exchange NGN→USDC via direct Treasury→Vault transfer ─
  if (!userWalletAddress) {
    console.log(`[payment] No user wallet for ${reference} — exchanging NGN→USDC directly from JaIre vault to escrow`);

    if (!bookingId) {
      console.warn(`[payment] No wallet and no booking for ${reference} — nothing to escrow`);
      return;
    }

    const vaultAddress = process.env["JAIRE_VAULT_ADDRESS"];
    if (!vaultAddress) {
      console.error(`[payment] JAIRE_VAULT_ADDRESS not set — cannot do direct escrow for ${reference}`);
      return;
    }

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!booking) {
      console.warn(`[payment] Booking ${bookingId} not found`);
      return;
    }

    const escrowAmount = booking.escrowAmountUsdc ?? amountUsdc;

    // Exchange: JaIre treasury converts the received NGN → USDC and puts it directly into the escrow vault
    const directRes = await fetch(`${MPC_SIDECAR}/mpc/fund-by-address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: vaultAddress,
        usdc_amount: escrowAmount,
        reference,
        memo: `JAIRE|EXCHANGE|${bookingId.slice(0, 8)}|${reference}|${escrowAmount}USDC`,
      }),
    });

    if (!directRes.ok) {
      console.error(`[payment] Direct vault escrow failed for ${reference}:`, await directRes.text());
      return;
    }

    const directData = (await directRes.json()) as { tx_signature?: string | null; error?: string };
    const directTx = directData.tx_signature ?? null;

    if (directTx) {
      console.log(`[payment] Direct exchange→escrow tx: ${directTx}`);
    } else {
      console.error(`[payment] Direct exchange→escrow FAILED for ${reference}: ${directData.error ?? "unknown"}`);
    }

    await db.update(payments).set({ txSignature: directTx, updatedAt: new Date() }).where(eq(payments.reference, reference));
    await db.update(bookings).set({
      status: "confirmed",
      escrowTxSignature: directTx ?? null,
      escrowAmountUsdc: escrowAmount,
      ngnAmountPaid: booking.ngnAmountPaid ?? payment.amountNgn,
      paymentMethod: "paystack",
    }).where(eq(bookings.id, bookingId));

    console.log(`[payment] Booking ${bookingId} confirmed via direct exchange. tx=${directTx}`);
    return;
  }

  // ── Step 1: Treasury → User wallet ─────────────────────────────────────
  console.log(`[payment] Step 1: Treasury → User wallet (${amountUsdc} USDC)`);
  const fundRes = await fetch(`${MPC_SIDECAR}/mpc/fund-by-address`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet_address: userWalletAddress,
      usdc_amount: amountUsdc,
      reference,
      memo: bookingId
        ? `JAIRE|TOPUP|${bookingId.slice(0, 8)}|${reference}|${amountUsdc}USDC`
        : `JAIRE|TOPUP|${reference}|${amountUsdc}USDC`,
    }),
  });

  if (!fundRes.ok) {
    console.error(`[payment] Fund-by-address failed:`, await fundRes.text());
    return;
  }

  const fundData = (await fundRes.json()) as { tx_signature?: string | null; success?: boolean; error?: string };
  const fundTx = fundData.tx_signature ?? null;
  if (fundTx) {
    console.log(`[payment] Funded user wallet tx: ${fundTx}`);
  } else {
    console.error(`[payment] Fund FAILED for ${reference}: ${fundData.error ?? "unknown error"}`);
  }

  // Save funding tx
  await db
    .update(payments)
    .set({ txSignature: fundTx, updatedAt: new Date() })
    .where(eq(payments.reference, reference));

  // ── Step 2: User wallet → Vault (escrow) if booking is linked ──────────
  if (!bookingId) {
    console.log(`[payment] No booking linked — skipping escrow`);
    return;
  }

  // Look up verifier_id from users table — try email first, then wallet address
  const [userByEmail] = await db.select().from(users).where(eq(users.email, userEmail));
  let escrowUser = userByEmail;
  if (!escrowUser?.verifierId && userWalletAddress) {
    const [userByWallet] = await db.select().from(users).where(eq(users.walletAddress, userWalletAddress));
    escrowUser = userByWallet ?? escrowUser;
  }
  // Get the booking first (needed by both branches below)
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!booking) {
    console.warn(`[payment] Booking ${bookingId} not found`);
    return;
  }

  if (!escrowUser?.verifierId) {
    console.warn(`[payment] No verifier_id found for ${userEmail} / ${userWalletAddress} — skipping on-chain escrow`);
    // Still mark booking as confirmed (funds were received) so user isn't stuck
    await db.update(bookings).set({
      status: "confirmed",
      escrowAmountUsdc: booking.escrowAmountUsdc ?? amountUsdc,
      ngnAmountPaid: booking.ngnAmountPaid ?? payment.amountNgn,
      paymentMethod: "paystack",
    }).where(eq(bookings.id, bookingId));
    console.warn(`[payment] Booking ${bookingId} confirmed WITHOUT on-chain escrow (no verifier_id)`);
    return;
  }

  // Escrow the FULL booking amount from the wallet (existing balance + just-funded USDC)
  const escrowAmount = booking.escrowAmountUsdc ?? amountUsdc;

  console.log(`[payment] Step 2: User wallet → Vault (${escrowAmount} USDC escrow for booking ${bookingId})`);

  const escrowRes = await fetch(`${MPC_SIDECAR}/mpc/internal/escrow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      verifier_id: escrowUser.verifierId,
      amount_usdc: escrowAmount,
      memo: `JAIRE|ESCROW|${bookingId.slice(0, 8)}|${escrowAmount}USDC|${userEmail}`,
    }),
  });

  if (!escrowRes.ok) {
    console.error(`[payment] Escrow failed:`, await escrowRes.text());
    return;
  }

  const escrowData = (await escrowRes.json()) as { tx_signature?: string };
  const escrowTx = escrowData.tx_signature;
  console.log(`[payment] Escrow tx: ${escrowTx}`);

  // Update booking: funds locked in vault — CONFIRMED, waiting for QR scan-in.
  // Preserve the booking's original ngnAmountPaid (total cost), not just the top-up shortfall.
  await db
    .update(bookings)
    .set({
      status: "confirmed",
      escrowTxSignature: escrowTx ?? null,
      escrowAmountUsdc: escrowAmount,
      ngnAmountPaid: booking.ngnAmountPaid ?? payment.amountNgn,
      paymentMethod: "paystack",
    })
    .where(eq(bookings.id, bookingId));

  console.log(`[payment] Booking ${bookingId} confirmed + escrowed. tx=${escrowTx}`);
}

export default router;
