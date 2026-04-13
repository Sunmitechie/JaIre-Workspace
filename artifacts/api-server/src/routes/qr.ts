import { Router } from "express";
import { createHmac, randomUUID } from "crypto";
import { db } from "@workspace/db";
import { workspaces, bookings, activityEvents, users } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

const SLOT_WINDOW_MS = 10_000;
const NGN_PER_USDC = 1600;
const MPC_SIDECAR = "http://localhost:9000";
const VAULT_ADDRESS = process.env["JAIRE_VAULT_ADDRESS"] ?? "41sVtGnHdLvutBd3HCg8GZ14toFrJAiK8KWHLBSVNsqP";

function currentSlot() {
  return Math.floor(Date.now() / SLOT_WINDOW_MS);
}

function slotHash(secret: string, slot: number): string {
  return createHmac("sha256", secret).update(slot.toString()).digest("hex").slice(0, 16);
}

function validateQRPayload(secret: string, incomingHash: string): boolean {
  const now = currentSlot();
  for (const slot of [now - 1, now, now + 1]) {
    if (slotHash(secret, slot) === incomingHash) return true;
  }
  return false;
}

function parseQRData(qrData: string): { workspace_id: string; slot_hash: string } | null {
  try {
    const decoded = Buffer.from(qrData, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (typeof parsed.w === "string" && typeof parsed.h === "string") {
      return { workspace_id: parsed.w, slot_hash: parsed.h };
    }
    return null;
  } catch {
    return null;
  }
}

// ── POST /qr/checkin ────────────────────────────────────────────────────────
router.post("/checkin", async (req, res) => {
  try {
    const { qr_data, user_id, user_name, user_email, user_wallet_address } = req.body as {
      qr_data?: string;
      user_id?: string;
      user_name?: string;
      user_email?: string;
      user_wallet_address?: string;
    };

    if (!qr_data) return res.status(400).json({ error: "qr_data is required" });

    const payload = parseQRData(qr_data);
    if (!payload) return res.status(400).json({ error: "Invalid QR code format" });

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, payload.workspace_id));
    if (!ws) return res.status(404).json({ error: "Workspace not found" });
    if (!ws.qrSecret) return res.status(400).json({ error: "Workspace QR not configured" });

    if (!validateQRPayload(ws.qrSecret, payload.slot_hash)) {
      return res.status(401).json({ error: "QR code expired or invalid — please scan the latest code" });
    }

    const uid = user_id || user_email || "guest";

    const existing = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.userId, uid), eq(bookings.status, "active")));

    if (existing.length > 0) {
      return res.status(409).json({
        error: "You are already checked in",
        booking_id: existing[0].id,
        workspace_name: ws.name,
      });
    }

    // Escrow amount = 8-hour cap (will settle actual at check-out)
    const escrowAmountUsdc = ws.hourlyRateUsdc * 8;

    // Attempt on-chain escrow: move USDC from user wallet → vault
    let escrowTxSignature: string | undefined;
    if (user_wallet_address) {
      try {
        const escrowRes = await fetch(`${MPC_SIDECAR}/mpc/fund-by-address`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wallet_address: VAULT_ADDRESS,
            usdc_amount: escrowAmountUsdc,
            reference: `escrow-checkin-${uid}-${Date.now()}`,
          }),
        });

        if (escrowRes.ok) {
          const escrowData = (await escrowRes.json()) as { tx_signature?: string };
          escrowTxSignature = escrowData.tx_signature;
          console.log(`[check-in] Escrow tx: ${escrowTxSignature} for ${escrowAmountUsdc} USDC`);
        } else {
          console.warn("[check-in] On-chain escrow failed:", await escrowRes.text());
        }
      } catch (err) {
        console.warn("[check-in] Escrow call error:", err);
      }
    }

    const [booking] = await db
      .insert(bookings)
      .values({
        id: randomUUID(),
        workspaceId: ws.id,
        userId: uid,
        userName: user_name || "JaIre Member",
        userEmail: user_email || null,
        status: "active",
        checkInTime: new Date(),
        plannedDurationHours: 8,
        escrowAmountUsdc,
        escrowTxSignature: escrowTxSignature ?? null,
        paymentMethod: "paystack",
        ngnAmountPaid: 0,
      })
      .returning();

    await db.insert(activityEvents).values({
      id: randomUUID(),
      eventType: "check_in",
      workspaceId: ws.id,
      workspaceName: ws.name,
      userId: uid,
      userName: user_name || "JaIre Member",
      amountUsdc: escrowAmountUsdc,
      amountNgn: Math.round(escrowAmountUsdc * NGN_PER_USDC),
    });

    // Upsert user record if wallet address supplied
    if (user_email && user_wallet_address) {
      await db
        .insert(users)
        .values({ email: user_email, name: user_name, walletAddress: user_wallet_address })
        .onConflictDoUpdate({
          target: users.email,
          set: { walletAddress: user_wallet_address, updatedAt: new Date() },
        });
    }

    res.status(201).json({
      booking_id: booking.id,
      workspace_id: ws.id,
      workspace_name: ws.name,
      check_in_time: booking.checkInTime!.toISOString(),
      hourly_rate_ngn: ws.hourlyRateNgn,
      escrow_usdc: escrowAmountUsdc,
      escrow_tx: escrowTxSignature ?? null,
    });
  } catch (err) {
    console.error("[QR check-in]", err);
    res.status(500).json({ error: "Check-in failed" });
  }
});

// ── POST /qr/checkout ───────────────────────────────────────────────────────
router.post("/checkout", async (req, res) => {
  try {
    const { qr_data, user_id, user_email, booking_id, user_wallet_address } = req.body as {
      qr_data?: string;
      user_id?: string;
      user_email?: string;
      booking_id?: string;
      user_wallet_address?: string;
    };

    if (!qr_data) return res.status(400).json({ error: "qr_data is required" });

    const payload = parseQRData(qr_data);
    if (!payload) return res.status(400).json({ error: "Invalid QR code format" });

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, payload.workspace_id));
    if (!ws || !ws.qrSecret) return res.status(404).json({ error: "Workspace not found" });

    if (!validateQRPayload(ws.qrSecret, payload.slot_hash)) {
      return res.status(401).json({ error: "QR code expired or invalid — please scan the latest code" });
    }

    const uid = user_id || user_email || "guest";

    const activeBookings = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.userId, uid), eq(bookings.status, "active")));

    let booking = activeBookings.find((b) => b.workspaceId === payload.workspace_id);
    if (!booking && booking_id) booking = activeBookings.find((b) => b.id === booking_id);
    if (!booking && activeBookings.length > 0) booking = activeBookings[0];

    if (!booking) return res.status(404).json({ error: "No active check-in found" });

    const checkInTime = booking.checkInTime ?? new Date();
    const checkOutTime = new Date();
    const elapsedSeconds = Math.max(60, Math.floor((checkOutTime.getTime() - checkInTime.getTime()) / 1000));

    const perSecondUsdc = ws.hourlyRateUsdc / 3600;
    const billedUsdc = parseFloat((perSecondUsdc * elapsedSeconds).toFixed(6));
    const billedNgn = parseFloat((billedUsdc * NGN_PER_USDC).toFixed(2));
    const escrowUsdc = booking.escrowAmountUsdc ?? 0;
    const refundUsdc = parseFloat(Math.max(0, escrowUsdc - billedUsdc).toFixed(6));

    // Settle on-chain: refund excess from vault → user wallet
    let settleTxSignature: string | undefined;
    const walletAddr = user_wallet_address;

    if (walletAddr && refundUsdc > 0) {
      try {
        const refundRes = await fetch(`${MPC_SIDECAR}/mpc/fund-by-address`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wallet_address: walletAddr,
            usdc_amount: refundUsdc,
            reference: `refund-checkout-${booking.id}`,
          }),
        });

        if (refundRes.ok) {
          const rd = (await refundRes.json()) as { tx_signature?: string };
          settleTxSignature = rd.tx_signature;
          console.log(`[check-out] Refund tx: ${settleTxSignature} — ${refundUsdc} USDC back to user`);
        } else {
          console.warn("[check-out] Refund failed:", await refundRes.text());
        }
      } catch (err) {
        console.warn("[check-out] Refund error:", err);
      }
    }

    const [updated] = await db
      .update(bookings)
      .set({
        status: "completed",
        checkOutTime,
        actualDurationSeconds: elapsedSeconds,
        billedAmountUsdc: billedUsdc,
        refundedAmountUsdc: refundUsdc,
        ngnAmountPaid: billedNgn,
        settlementTxSignature: settleTxSignature ?? null,
      })
      .where(eq(bookings.id, booking.id))
      .returning();

    await db.insert(activityEvents).values({
      id: randomUUID(),
      eventType: "check_out",
      workspaceId: ws.id,
      workspaceName: ws.name,
      userId: uid,
      userName: booking.userName,
      amountUsdc: billedUsdc,
      amountNgn: billedNgn,
    });

    const h = Math.floor(elapsedSeconds / 3600);
    const m = Math.floor((elapsedSeconds % 3600) / 60);
    const s = elapsedSeconds % 60;

    res.json({
      booking_id: booking.id,
      workspace_name: ws.name,
      duration_display: `${h}h ${m}m ${s}s`,
      duration_seconds: elapsedSeconds,
      billed_usdc: billedUsdc,
      billed_ngn: billedNgn,
      refunded_usdc: refundUsdc,
      settle_tx: settleTxSignature ?? null,
      check_in_time: checkInTime.toISOString(),
      check_out_time: checkOutTime.toISOString(),
    });
  } catch (err) {
    console.error("[QR checkout]", err);
    res.status(500).json({ error: "Checkout failed" });
  }
});

// ── GET /qr/generate/:workspaceId ──────────────────────────────────────────
router.get("/generate/:workspaceId", async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!ws || !ws.qrSecret) return res.status(404).json({ error: "Workspace not found" });

    const slot = currentSlot();
    const hash = slotHash(ws.qrSecret, slot);
    const payload = Buffer.from(JSON.stringify({ w: ws.id, h: hash })).toString("base64url");
    const expiresInMs = SLOT_WINDOW_MS - (Date.now() % SLOT_WINDOW_MS);

    res.json({
      qr_data: payload,
      workspace_id: ws.id,
      workspace_name: ws.name,
      expires_in_ms: expiresInMs,
      slot,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate QR" });
  }
});

export default router;
