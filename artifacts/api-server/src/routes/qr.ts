import { Router, Request, Response } from "express";
import { createHmac, randomBytes, randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { workspaces, bookings, activityEvents, users, organizations, devices } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { publishCommand, isConnected as mqttConnected } from "../services/mqtt";

const router = Router();

const SLOT_WINDOW_MS = 10_000;
const NGN_PER_USDC = 1600;
const MPC_SIDECAR = "http://localhost:9000";
const JWT_SECRET = process.env["JWT_SECRET"] ?? "jaire-dev-secret";

// ── Helpers ──────────────────────────────────────────────────────────────────

function currentSlot() {
  return Math.floor(Date.now() / SLOT_WINDOW_MS);
}

function slotHash(secret: string, slot: number): string {
  return createHmac("sha256", secret).update(slot.toString()).digest("hex").slice(0, 16);
}

function validateSlotHash(secret: string, incomingHash: string): boolean {
  const now = currentSlot();
  for (const slot of [now - 1, now, now + 1]) {
    if (slotHash(secret, slot) === incomingHash) return true;
  }
  return false;
}

type ParsedQR =
  | { type: "org"; org_id: string; slot_hash: string }
  | { type: "workspace"; workspace_id: string; slot_hash: string }
  | null;

function parseQRData(qrData: string): ParsedQR {
  try {
    const decoded = Buffer.from(qrData, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (typeof parsed.o === "string" && typeof parsed.h === "string") {
      return { type: "org", org_id: parsed.o, slot_hash: parsed.h };
    }
    if (typeof parsed.w === "string" && typeof parsed.h === "string") {
      return { type: "workspace", workspace_id: parsed.w, slot_hash: parsed.h };
    }
    return null;
  } catch {
    return null;
  }
}

// Org auth middleware (same pattern as org.ts)
function requireOrgAuth(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing auth token" });
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { email: string };
    (req as any).orgEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ── GET /qr/org — generate rotating org-level QR ─────────────────────────────
// Requires org auth. Returns a base64url payload; frontend encodes it into a URL.
router.get("/org", requireOrgAuth, async (req: Request, res: Response) => {
  try {
    const email = (req as any).orgEmail as string;
    let [org] = await db.select().from(organizations).where(eq(organizations.ownerEmail, email)).limit(1);
    if (!org) return res.status(404).json({ error: "Org not found" });

    // Auto-init qrSecret for this org on first request
    if (!org.qrSecret) {
      const secret = randomBytes(32).toString("hex");
      const [updated] = await db
        .update(organizations)
        .set({ qrSecret: secret })
        .where(eq(organizations.id, org.id))
        .returning();
      org = updated ?? org;
      if (!org.qrSecret) return res.status(500).json({ error: "Failed to initialize QR secret" });
    }

    const slot = currentSlot();
    const hash = slotHash(org.qrSecret, slot);
    const qrPayload = Buffer.from(JSON.stringify({ o: org.id, h: hash })).toString("base64url");
    const expiresInMs = SLOT_WINDOW_MS - (Date.now() % SLOT_WINDOW_MS);

    res.json({
      qr_data: qrPayload,
      org_id: org.id,
      org_name: org.businessName ?? org.ownerName ?? "Your Space",
      expires_in_ms: expiresInMs,
      slot,
    });
  } catch (err) {
    console.error("[QR org generate]", err);
    res.status(500).json({ error: "Failed to generate QR" });
  }
});

// ── POST /qr/checkin ─────────────────────────────────────────────────────────
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

    const uid = user_id || user_email || "guest";

    // ── Already checked in? ──────────────────────────────────────────────────
    const existing = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.userId, uid), eq(bookings.status, "active")));

    if (existing.length > 0) {
      return res.status(409).json({
        error: "You are already checked in",
        booking_id: existing[0].id,
        check_in_time: existing[0].checkInTime?.toISOString(),
      });
    }

    // ── Resolve workspace and validate QR ────────────────────────────────────
    type WsRow = typeof workspaces.$inferSelect;
    let ws: WsRow | undefined;

    if (payload.type === "org") {
      // Org-level QR: validate against org's qrSecret
      const [org] = await db.select().from(organizations).where(eq(organizations.id, payload.org_id)).limit(1);
      if (!org) return res.status(404).json({ error: "Organisation not found" });
      if (!org.qrSecret) return res.status(400).json({ error: "QR not configured for this org" });
      if (!validateSlotHash(org.qrSecret, payload.slot_hash)) {
        return res.status(401).json({ error: "QR code expired — please scan the current code" });
      }

      // Find user's confirmed booking for any workspace belonging to this org
      const orgWorkspaces = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.orgId, org.id));
      const wsIds = orgWorkspaces.map((w) => w.id);

      if (wsIds.length === 0) return res.status(400).json({ error: "This org has no workspaces listed yet" });

      const confirmedBookings = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.userId, uid), eq(bookings.status, "confirmed")));

      const confirmedForOrg = confirmedBookings.find((b) => wsIds.includes(b.workspaceId!));

      if (confirmedForOrg) {
        const [wsRow] = await db.select().from(workspaces).where(eq(workspaces.id, confirmedForOrg.workspaceId!));
        ws = wsRow;
      } else {
        // Walk-in: use first available workspace in the org
        const [available] = await db
          .select()
          .from(workspaces)
          .where(and(eq(workspaces.orgId, org.id), eq(workspaces.isAvailable, true)))
          .limit(1);

        if (!available) return res.status(400).json({ error: "No confirmed booking found and no available workspace in this org" });
        ws = available;
      }

    } else {
      // Legacy workspace-level QR
      const [wsRow] = await db.select().from(workspaces).where(eq(workspaces.id, payload.workspace_id));
      if (!wsRow) return res.status(404).json({ error: "Workspace not found" });
      if (!wsRow.qrSecret) return res.status(400).json({ error: "Workspace QR not configured" });
      if (!validateSlotHash(wsRow.qrSecret, payload.slot_hash)) {
        return res.status(401).json({ error: "QR code expired — please scan the current code" });
      }
      ws = wsRow;
    }

    if (!ws) return res.status(500).json({ error: "Could not resolve workspace" });

    // ── Find or create booking ────────────────────────────────────────────────
    const confirmedBookings = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.userId, uid), eq(bookings.status, "confirmed")));

    const confirmedForWs = confirmedBookings.find((b) => b.workspaceId === ws!.id) ?? confirmedBookings[0];

    let booking: typeof confirmedBookings[0];
    const checkInTime = new Date();

    if (confirmedForWs) {
      const [updated] = await db
        .update(bookings)
        .set({ status: "active", checkInTime })
        .where(eq(bookings.id, confirmedForWs.id))
        .returning();
      booking = updated;
      console.log(`[QR check-in] Promoted confirmed booking ${booking.id} → active`);
    } else {
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

    // ── MQTT: power ON all devices in this workspace ─────────────────────────
    if (ws.orgId) {
      (async () => {
        try {
          const wsDevices = await db
            .select()
            .from(devices)
            .where(and(eq(devices.orgId, ws!.orgId!), eq(devices.workspaceId, ws!.id)));
          for (const d of wsDevices) {
            const sent = publishCommand(ws!.orgId!, d.mqttClientId, { action: "on" });
            console.log(`[MQTT] Check-in power ON → ${d.mqttClientId} (sent=${sent})`);
          }
          if (wsDevices.length === 0) {
            console.log(`[MQTT] No devices in workspace ${ws!.id} to power on`);
          }
        } catch (e) {
          console.warn("[MQTT] check-in power command error:", e);
        }
      })();
    }
  } catch (err) {
    console.error("[QR check-in]", err);
    res.status(500).json({ error: "Check-in failed" });
  }
});

// ── POST /qr/checkout ────────────────────────────────────────────────────────
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

    // ── Validate QR ──────────────────────────────────────────────────────────
    let allowedWorkspaceIds: string[] | null = null;

    if (payload.type === "org") {
      const [org] = await db.select().from(organizations).where(eq(organizations.id, payload.org_id)).limit(1);
      if (!org?.qrSecret) return res.status(404).json({ error: "Organisation QR not configured" });
      if (!validateSlotHash(org.qrSecret, payload.slot_hash)) {
        return res.status(401).json({ error: "QR code expired — please scan the current code" });
      }
      const orgWorkspaces = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.orgId, org.id));
      allowedWorkspaceIds = orgWorkspaces.map((w) => w.id);
    } else {
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, payload.workspace_id));
      if (!ws?.qrSecret) return res.status(404).json({ error: "Workspace not found" });
      if (!validateSlotHash(ws.qrSecret, payload.slot_hash)) {
        return res.status(401).json({ error: "QR code expired — please scan the current code" });
      }
      allowedWorkspaceIds = [ws.id];
    }

    const uid = user_id || user_email || "guest";

    const activeBookings = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.userId, uid), eq(bookings.status, "active")));

    let booking = activeBookings.find((b) => allowedWorkspaceIds!.includes(b.workspaceId!));
    if (!booking && booking_id) booking = activeBookings.find((b) => b.id === booking_id);
    if (!booking && activeBookings.length > 0) booking = activeBookings[0];
    if (!booking) return res.status(404).json({ error: "No active check-in found" });

    // ── Fetch workspace for rate calculation ─────────────────────────────────
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, booking.workspaceId!));
    if (!ws) return res.status(500).json({ error: "Workspace record missing" });

    const checkInTime = booking.checkInTime ?? new Date();
    const checkOutTime = new Date();
    const elapsedSeconds = Math.max(60, Math.floor((checkOutTime.getTime() - checkInTime.getTime()) / 1000));

    const perSecondUsdc = ws.hourlyRateUsdc / 3600;
    const billedUsdc = parseFloat((perSecondUsdc * elapsedSeconds).toFixed(6));
    const billedNgn = parseFloat((billedUsdc * NGN_PER_USDC).toFixed(2));
    const escrowUsdc = booking.escrowAmountUsdc ?? (ws.hourlyRateUsdc * 8);
    const refundUsdc = parseFloat(Math.max(0, escrowUsdc - billedUsdc).toFixed(6));

    // Resolve user wallet — prefer request body, fallback to DB lookup
    let walletAddr = user_wallet_address ?? null;
    if (!walletAddr && (user_email || user_id)) {
      try {
        const lookupEmail = user_email || user_id!;
        const [userRow] = await db.select({ walletAddress: users.walletAddress })
          .from(users).where(eq(users.email, lookupEmail)).limit(1);
        walletAddr = userRow?.walletAddress ?? null;
        if (walletAddr) console.log(`[checkout] Resolved wallet from DB for ${lookupEmail}: ${walletAddr.slice(0, 8)}...`);
      } catch {}
    }

    // ── Vault → User (refund excess) ─────────────────────────────────────────
    let settleTxSignature: string | null = null;
    if (walletAddr && refundUsdc > 0.000001) {
      try {
        const settleRes = await fetch(`${MPC_SIDECAR}/mpc/vault-settle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to_address: walletAddr, amount_usdc: refundUsdc }),
        });
        if (settleRes.ok) {
          const sd = (await settleRes.json()) as { tx_signature?: string | null };
          settleTxSignature = sd.tx_signature ?? null;
        }
      } catch (err) {
        console.warn(`[checkout] Settle error:`, err);
      }
    }

    // ── Vault → Org wallet (85% revenue share) ───────────────────────────────
    if (billedUsdc > 0.0001 && ws.orgId) {
      (async () => {
        try {
          const [org] = await db.select({ ownerWalletAddress: organizations.ownerWalletAddress })
            .from(organizations).where(eq(organizations.id, ws.orgId!)).limit(1);
          if (org?.ownerWalletAddress) {
            const orgShare = parseFloat((billedUsdc * 0.85).toFixed(6));
            const memo = `JAIRE|SETTLE|${booking!.id.slice(0, 8)}|${orgShare}USDC|85PCT`;
            const payRes = await fetch(`${MPC_SIDECAR}/mpc/fund-by-address`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ wallet_address: org.ownerWalletAddress, usdc_amount: orgShare, memo }),
            });
            if (payRes.ok) {
              const pd = (await payRes.json()) as { tx_signature?: string | null };
              console.log(`[checkout] Org paid ${orgShare} USDC (85%). tx=${pd.tx_signature}`);
            }
          }
        } catch (e) {
          console.warn(`[checkout] Org settlement error:`, e);
        }
      })();
    }

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

    // Log vault 15% retention explicitly
    const vaultRetention = parseFloat((billedUsdc * 0.15).toFixed(6));
    console.log(`[checkout] Vault retention: ${vaultRetention} USDC (15% of ${billedUsdc}) → JaIre vault 41sVtGn…`);

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

    // ── MQTT: power OFF all devices in this workspace ────────────────────────
    if (ws.orgId) {
      (async () => {
        try {
          const wsDevices = await db
            .select()
            .from(devices)
            .where(and(eq(devices.orgId, ws.orgId!), eq(devices.workspaceId, ws.id)));
          for (const d of wsDevices) {
            const sent = publishCommand(ws.orgId!, d.mqttClientId, { action: "off" });
            console.log(`[MQTT] Check-out power OFF → ${d.mqttClientId} (sent=${sent})`);
          }
          if (wsDevices.length === 0) {
            console.log(`[MQTT] No devices in workspace ${ws.id} to power off`);
          }
        } catch (e) {
          console.warn("[MQTT] check-out power command error:", e);
        }
      })();
    }
  } catch (err) {
    console.error("[QR checkout]", err);
    res.status(500).json({ error: "Checkout failed" });
  }
});

// ── GET /qr/generate/:workspaceId — legacy per-workspace QR (kept for compat) ─
router.get("/generate/:workspaceId", async (req, res) => {
  try {
    const { workspaceId } = req.params;
    let [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!ws) return res.status(404).json({ error: "Workspace not found" });

    if (!ws.qrSecret) {
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
