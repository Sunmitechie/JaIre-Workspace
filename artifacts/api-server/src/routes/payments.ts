import { Router } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { payments, users, bookings } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

const PAYSTACK_SECRET = process.env["PAYSTACK_SECRET_KEY"]!;
const PAYSTACK_BASE = "https://api.paystack.co";

// FX: JaIre earns 0.5% on each conversion
const MARKET_RATE_NGN_PER_USDC = 1600;
const FX_SPREAD_PCT = 0.5;
const JAIRE_RATE = MARKET_RATE_NGN_PER_USDC * (1 + FX_SPREAD_PCT / 100); // ~1608

function ngnToUsdc(ngn: number): number {
  return parseFloat((ngn / JAIRE_RATE).toFixed(6));
}

function generateRef(): string {
  return `JI-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

// ── POST /api/payments/initiate ────────────────────────────────────────────
// Initiates a Paystack transaction and stores a pending payment record
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

    // Call Paystack initialize
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
            { display_name: "USDC Amount", variable_name: "usdc_amount", value: amountUsdc },
          ],
        },
      }),
    });

    const psData = (await psRes.json()) as any;
    if (!psRes.ok || !psData.status) {
      return res.status(502).json({ error: psData.message ?? "Paystack error" });
    }

    // Store pending payment
    await db.insert(payments).values({
      bookingId: booking_id,
      userEmail: user_email,
      userWalletAddress: user_wallet_address,
      amountNgn: amount_ngn,
      amountUsdc: amountUsdc,
      fxRate: JAIRE_RATE,
      fxSpreadPct: FX_SPREAD_PCT,
      reference,
      provider: "paystack",
      status: "pending",
    });

    // Upsert user record
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
      fx_rate: JAIRE_RATE,
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

    const txData = psData.data;
    const isPaid = txData.status === "success";

    if (isPaid) {
      await db
        .update(payments)
        .set({ status: "success", updatedAt: new Date() })
        .where(eq(payments.reference, reference));

      // Trigger USDC funding if not already done
      const [payment] = await db.select().from(payments).where(eq(payments.reference, reference));
      if (payment?.userWalletAddress && !payment.txSignature) {
        await triggerUsdcFunding(payment);
      }
    }

    res.json({
      reference,
      status: txData.status,
      amount_ngn: txData.amount / 100,
      paid: isPaid,
      paid_at: txData.paid_at,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Verification failed" });
  }
});

// ── POST /api/payments/webhook ─────────────────────────────────────────────
router.post("/payments/webhook", async (req, res) => {
  const signature = req.headers["x-paystack-signature"] as string;
  const rawBody = JSON.stringify(req.body);

  // Verify Paystack webhook signature
  const expected = crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(rawBody)
    .digest("hex");

  if (signature !== expected) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  const event = req.body as any;
  res.sendStatus(200); // Acknowledge immediately

  try {
    if (event.event === "charge.success") {
      const { reference } = event.data;
      const amountNgn = event.data.amount / 100;

      await db
        .update(payments)
        .set({ status: "success", updatedAt: new Date() })
        .where(eq(payments.reference, reference));

      const [payment] = await db.select().from(payments).where(eq(payments.reference, reference));

      if (payment) {
        // Update booking payment status if linked
        if (payment.bookingId) {
          await db
            .update(bookings)
            .set({ ngnAmountPaid: amountNgn, paymentMethod: "paystack" })
            .where(eq(bookings.id, payment.bookingId));
        }
        // Trigger on-chain USDC credit
        if (payment.userWalletAddress && !payment.txSignature) {
          await triggerUsdcFunding(payment);
        }
      }
    }
  } catch (err) {
    console.error("[webhook] Processing error:", err);
  }
});

// ── GET /api/payments/status/:reference ────────────────────────────────────
router.get("/payments/status/:reference", async (req, res) => {
  const { reference } = req.params;
  try {
    const [payment] = await db.select().from(payments).where(eq(payments.reference, reference));
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.json(payment);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Internal: fund user wallet via MPC sidecar ─────────────────────────────
async function triggerUsdcFunding(payment: typeof payments.$inferSelect) {
  const MPC_SIDECAR = "http://localhost:9000";
  try {
    const res = await fetch(`${MPC_SIDECAR}/mpc/fund-by-address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet_address: payment.userWalletAddress,
        usdc_amount: payment.amountUsdc,
        reference: payment.reference,
      }),
    });

    if (!res.ok) {
      console.error("[payments] MPC fund-wallet failed:", await res.text());
      return;
    }

    const data = (await res.json()) as { tx_signature?: string };
    if (data.tx_signature) {
      await db
        .update(payments)
        .set({ txSignature: data.tx_signature, updatedAt: new Date() })
        .where(eq(payments.reference, payment.reference));
    }
  } catch (err) {
    console.error("[payments] triggerUsdcFunding error:", err);
  }
}

export default router;
