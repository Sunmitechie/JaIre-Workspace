import { Router } from "express";
import { createHmac, randomUUID } from "crypto";
import { db } from "@workspace/db";
import { workspaces, bookings, activityEvents, users, organizations } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

const SLOT_WINDOW_MS = 10_000;
const NGN_PER_USDC = 1600;
const MPC_SIDECAR = "http://localhost:9000";

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
// Check-in ONLY starts the clock. Funds are already in escrow from the
// payment webhook — no on-chain movement happens here.
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
      return res.status(401).json({ error: "QR code expired — please scan the current code" });
    }

    const uid = user_id || user_email || "guest";

    // Check if already actively checked in
    const existing = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.userId, uid), eq(bookings.status, "active")));

    if (existing.length > 0) {
      return res.status(409).json({
        error: "You are already checked in",
        booking_id: existing[0].id,
        workspace_name: ws.name,
        check_in_time: existing[0].checkInTime?.toISOString(),
      });
    }

    // Look for a confirmed (paid + escrowed) booking for this workspace.
    // Promote it to "active" and record check-in time — no new booking needed.
    const confirmedBookings = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.userId, uid), eq(bookings.status, "confirmed")));

    const confirmedForWs = confirmedBookings.find((b) => b.workspaceId === ws.id)
      ?? confirmedBookings[0]; // accept any confirmed booking as a fallback

    let booking: typeof confirmedBookings[0];
    const checkInTime = new Date();

    if (confirmedForWs) {
      // Transition the existing confirmed booking to active — timer starts now
      const [updated] = await db
        .update(bookings)
        .set({ status: "active", checkInTime })
        .where(eq(bookings.id, confirmedForWs.id))
        .returning();
      booking = updated;
      console.log(`[QR check-in] Promoted confirmed booking ${booking.id} → active`);
    } else {
      // Walk-in: no pre-paid booking — create one and start it immediately
      const [created] = await db
        .insert(bookings)
        .values({
          id: randomUUID(),
          workspaceId: ws.id,
          userId: uid,
          userName: user_name || "JaIre Member",
          userEmail: user_email || null,
          status: "active",
          checkInTime,
          plannedDurationHours: 8,
          escrowAmountUsdc: ws.hourlyRateUsdc * 8,
          paymentMethod: "paystack",
          ngnAmountPaid: 0,
        })
        .returning();
      booking = created;
      console.log(`[QR check-in] Walk-in booking ${booking.id} created`);
    }

    await db.insert(activityEvents).values({
      id: randomUUID(),
      eventType: "check_in",
      workspaceId: ws.id,
      workspaceName: ws.name,
      userId: uid,
      userName: user_name || "JaIre Member",
      amountUsdc: null,
      amountNgn: null,
    });

    // Upsert user record
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
      check_in_time: checkInTime.toISOString(),
      hourly_rate_ngn: ws.hourlyRateNgn,
      escrow_tx_signature: booking.escrowTxSignature ?? null,
      message: "Welcome! Your session has started. USDC is in escrow.",
    });
  } catch (err) {
    console.error("[QR check-in]", err);
    res.status(500).json({ error: "Check-in failed" });
  }
});

// ── POST /qr/checkout ───────────────────────────────────────────────────────
// Calculates exact billed USDC, returns excess from vault back to user.
// Vault keeps the billed amount; refund goes on-chain via vault keypair.
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
      return res.status(401).json({ error: "QR code expired — please scan the current code" });
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
    const escrowUsdc = booking.escrowAmountUsdc ?? (ws.hourlyRateUsdc * 8);
    const refundUsdc = parseFloat(Math.max(0, escrowUsdc - billedUsdc).toFixed(6));

    // Look up user wallet address if not in request
    const walletAddr = user_wallet_address ?? (() => {
      // Don't block checkout if wallet not found — just skip refund
      return null;
    })();

    // ── Vault → User (refund excess) ───────────────────────────────────────
    let settleTxSignature: string | null = null;
    if (walletAddr && refundUsdc > 0.000001) {
      console.log(`[checkout] Vault → User refund: ${refundUsdc} USDC`);
      try {
        const settleRes = await fetch(`${MPC_SIDECAR}/mpc/vault-settle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to_address: walletAddr, amount_usdc: refundUsdc }),
        });

        if (settleRes.ok) {
          const sd = (await settleRes.json()) as { tx_signature?: string | null };
          settleTxSignature = sd.tx_signature ?? null;
          console.log(`[checkout] Settle tx: ${settleTxSignature}`);
        } else {
          console.warn(`[checkout] Vault settle failed:`, await settleRes.text());
        }
      } catch (err) {
        console.warn(`[checkout] Settle error:`, err);
      }
    } else if (refundUsdc <= 0.000001) {
      console.log(`[checkout] Billed = escrow — no refund needed`);
    }

    // ── Vault → Org wallet (85% revenue share) ─────────────────────────────
    // Fire-and-forget: look up the org that owns this workspace and pay them
    if (billedUsdc > 0.0001 && ws.orgId) {
      (async () => {
        try {
          const [org] = await db.select({ ownerWalletAddress: organizations.ownerWalletAddress })
            .from(organizations).where(eq(organizations.id, ws.orgId!)).limit(1);

          if (org?.ownerWalletAddress) {
            const orgShare = parseFloat((billedUsdc * 0.85).toFixed(6));
            const memo = `JAIRE|SETTLE|${booking.id.slice(0, 8)}|${orgShare}USDC|85PCT`;
            const payRes = await fetch(`${MPC_SIDECAR}/mpc/fund-by-address`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ wallet_address: org.ownerWalletAddress, usdc_amount: orgShare, memo }),
            });
            if (payRes.ok) {
              const pd = (await payRes.json()) as { tx_signature?: string | null };
              console.log(`[checkout] Org ${ws.orgId} paid ${orgShare} USDC (85%). tx=${pd.tx_signature}`);
            } else {
              console.warn(`[checkout] Org payment failed:`, await payRes.text());
            }
          } else {
            console.log(`[checkout] Workspace ${ws.id} has no org wallet — skipping 85% settlement`);
          }
        } catch (e) {
          console.warn(`[checkout] Org settlement error:`, e);
        }
      })();
    }

    // Update booking
    await db
      .update(bookings)
      .set({
        status: "completed",
        checkOutTime,
        actualDurationSeconds: elapsedSeconds,
        billedAmountUsdc: billedUsdc,
        refundedAmountUsdc: refundUsdc,
        ngnAmountPaid: billedNgn,
        settlementTxSignature: settleTxSignature,
      })
      .where(eq(bookings.id, booking.id));

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
      billed_ngn: billedNgn,
      billed_usdc: billedUsdc,
      escrow_usdc: escrowUsdc,
      refunded_usdc: refundUsdc,
      settle_tx: settleTxSignature,
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
    let [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    // Auto-initialize qrSecret if missing — happens on first QR request for a workspace
    if (!ws.qrSecret) {
      const { randomBytes } = await import("crypto");
      const newSecret = randomBytes(32).toString("hex");
      const [updated] = await db
        .update(workspaces)
        .set({ qrSecret: newSecret })
        .where(eq(workspaces.id, workspaceId))
        .returning();
      ws = updated ?? ws;
      if (!ws.qrSecret) return res.status(500).json({ error: "Failed to initialize QR secret" });
    }

    const slot = currentSlot();
    const hash = slotHash(ws.qrSecret, slot);
    const qrPayload = Buffer.from(JSON.stringify({ w: ws.id, h: hash })).toString("base64url");
    const expiresInMs = SLOT_WINDOW_MS - (Date.now() % SLOT_WINDOW_MS);

    res.json({
      qr_data: qrPayload,
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
