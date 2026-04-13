import { Router } from "express";
import { createHmac, randomUUID } from "crypto";
import { db } from "@workspace/db";
import { workspaces, bookings, activityEvents } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

const SLOT_WINDOW_MS = 10_000;
const NGN_PER_USDC = 1600;

function currentSlot() {
  return Math.floor(Date.now() / SLOT_WINDOW_MS);
}

function slotHash(secret: string, slot: number): string {
  return createHmac("sha256", secret).update(slot.toString()).digest("hex").slice(0, 16);
}

function validateQRPayload(
  secret: string,
  incomingHash: string
): boolean {
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

router.post("/checkin", async (req, res) => {
  try {
    const { qr_data, user_id, user_name, user_email } = req.body as {
      qr_data?: string;
      user_id?: string;
      user_name?: string;
      user_email?: string;
    };

    if (!qr_data) {
      return res.status(400).json({ error: "qr_data is required" });
    }

    const payload = parseQRData(qr_data);
    if (!payload) {
      return res.status(400).json({ error: "Invalid QR code format" });
    }

    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, payload.workspace_id));

    if (!ws) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    if (!ws.qrSecret) {
      return res.status(400).json({ error: "Workspace QR not configured" });
    }

    if (!validateQRPayload(ws.qrSecret, payload.slot_hash)) {
      return res.status(401).json({ error: "QR code expired or invalid — please scan the latest code" });
    }

    const uid = user_id || "guest";

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
        escrowAmountUsdc: ws.hourlyRateUsdc * 8,
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
      amountUsdc: null,
      amountNgn: null,
    });

    res.status(201).json({
      booking_id: booking.id,
      workspace_id: ws.id,
      workspace_name: ws.name,
      check_in_time: booking.checkInTime!.toISOString(),
      hourly_rate_ngn: ws.hourlyRateNgn,
    });
  } catch (err) {
    console.error("[QR check-in]", err);
    res.status(500).json({ error: "Check-in failed" });
  }
});

router.post("/checkout", async (req, res) => {
  try {
    const { qr_data, user_id, booking_id } = req.body as {
      qr_data?: string;
      user_id?: string;
      booking_id?: string;
    };

    if (!qr_data) {
      return res.status(400).json({ error: "qr_data is required" });
    }

    const payload = parseQRData(qr_data);
    if (!payload) {
      return res.status(400).json({ error: "Invalid QR code format" });
    }

    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, payload.workspace_id));

    if (!ws || !ws.qrSecret) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    if (!validateQRPayload(ws.qrSecret, payload.slot_hash)) {
      return res.status(401).json({ error: "QR code expired or invalid — please scan the latest code" });
    }

    const uid = user_id || "guest";

    const activeBookings = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.userId, uid), eq(bookings.status, "active")));

    let booking = activeBookings.find((b) => b.workspaceId === payload.workspace_id);
    if (!booking && booking_id) {
      booking = activeBookings.find((b) => b.id === booking_id);
    }
    if (!booking && activeBookings.length > 0) {
      booking = activeBookings[0];
    }

    if (!booking) {
      return res.status(404).json({ error: "No active check-in found" });
    }

    const checkInTime = booking.checkInTime ?? new Date();
    const checkOutTime = new Date();
    const elapsedSeconds = Math.max(0, Math.floor((checkOutTime.getTime() - checkInTime.getTime()) / 1000));

    const perSecondUsdc = ws.hourlyRateUsdc / 3600;
    const billedUsdc = parseFloat((perSecondUsdc * elapsedSeconds).toFixed(6));
    const billedNgn = parseFloat((billedUsdc * NGN_PER_USDC).toFixed(2));

    const [updated] = await db
      .update(bookings)
      .set({
        status: "completed",
        checkOutTime,
        actualDurationSeconds: elapsedSeconds,
        billedAmountUsdc: billedUsdc,
        refundedAmountUsdc: 0,
        ngnAmountPaid: billedNgn,
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
      billed_ngn: billedNgn,
      check_in_time: checkInTime.toISOString(),
      check_out_time: checkOutTime.toISOString(),
    });
  } catch (err) {
    console.error("[QR checkout]", err);
    res.status(500).json({ error: "Checkout failed" });
  }
});

router.get("/generate/:workspaceId", async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));

    if (!ws || !ws.qrSecret) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    const slot = currentSlot();
    const hash = slotHash(ws.qrSecret, slot);
    const payload = Buffer.from(
      JSON.stringify({ w: ws.id, h: hash })
    ).toString("base64url");

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
