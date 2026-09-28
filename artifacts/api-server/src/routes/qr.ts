import { Router, Request, Response, NextFunction } from "express";
import { randomBytes, randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { workspaces, bookings, activityEvents, users, organizations, devices } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { publishCommand, isConnected as mqttConnected } from "../services/mqtt";
import { logger } from "../lib/logger";
import { getRequiredSecret } from "../lib/secrets";
import { SLOT_WINDOW_MS, currentSlot, slotHash, validateSlotHash, parseQRData } from "../lib/qr-crypto";

const router = Router();

const NGN_PER_USDC = 1600;
const MPC_SIDECAR = "http://localhost:9000";
const JWT_SECRET = getRequiredSecret("JWT_SECRET");

// Org auth middleware (same pattern as org.ts)
function requireOrgAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing auth token" });
    return;
  }

  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { email?: string };
    if (!payload.email) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    (req as any).orgEmail = payload.email;
    next();
    return;
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
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
    logger.error({ err }, "[QR org generate]");
    res.status(500).json({ error: "Failed to generate QR" });
  }
});

// ── POST /qr/checkin ─────────────────────────────────────────────────────────
router.post("/checkin", async (req, res) => {
  try {
    const { qr_data, user_id, user_name, user_email, user_wallet_address, verifier_id } = req.body as {
      qr_data?: string;
      user_id?: string;
      user_name?: string;
      user_email?: string;
      user_wallet_address?: string;
      verifier_id?: string;  // Web3Auth verifier ID — used to derive MPC keypair for escrow lock
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
      logger.info({ bookingId: booking.id }, "[QR check-in] Promoted confirmed booking to active");
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
      logger.info({ bookingId: booking.id }, "[QR check-in] Walk-in booking created");
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

    // ── Escrow lock: user wallet → vault (async, does not block check-in) ────
    // If verifier_id and wallet address are available, lock the pre-paid USDC
    // into escrow immediately after check-in. The user's MPC keypair signs.
    if (verifier_id && user_wallet_address && booking.escrowAmountUsdc && booking.escrowAmountUsdc > 0) {
      (async () => {
        try {
          const plannedSec = (booking.plannedDurationHours ?? 8) * 3600;
          const escrowRes = await fetch(`${MPC_SIDECAR}/mpc/escrow/initialize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              verifier_id,
              user_wallet_address,
              booking_id: booking.id,
              planned_seconds: plannedSec,
              escrow_usdc: booking.escrowAmountUsdc,
            }),
          });
          if (escrowRes.ok) {
            const ed = (await escrowRes.json()) as { tx_signature?: string | null };
            if (ed.tx_signature) {
              await db.update(bookings)
                .set({ escrowTxSignature: ed.tx_signature })
                .where(eq(bookings.id, booking.id));
              logger.info({ bookingId: booking.id, txSignature: ed.tx_signature }, "[checkin/escrow] Locked booking escrow");
            }
          } else {
            const errBody = await escrowRes.text();
            logger.warn({ bookingId: booking.id, errBody }, "[checkin/escrow] Lock failed");
          }
        } catch (e) {
          logger.warn({ err: e }, "[checkin/escrow] Lock error");
        }
      })();
    } else {
      logger.info({
        verifierIdPresent: !!verifier_id,
        walletPresent: !!user_wallet_address,
        escrowAmount: booking.escrowAmountUsdc,
      }, "[checkin/escrow] Skipping on-chain lock");
    }

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
            logger.info({ clientId: d.mqttClientId, sent }, "[MQTT] Check-in power ON");
          }
          if (wsDevices.length === 0) {
            logger.info({ workspaceId: ws!.id }, "[MQTT] No devices in workspace to power on");
          }
        } catch (e) {
          logger.warn({ err: e }, "[MQTT] check-in power command error");
        }
      })();
    }
  } catch (err) {
    logger.error({ err }, "[QR check-in]");
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
        if (walletAddr) logger.info({ lookupEmail, walletPrefix: walletAddr.slice(0, 8) }, "[checkout] Resolved wallet from DB");
      } catch {}
    }

    // ── Atomic escrow settlement: 85% → org, refund → user, 15% stays in vault ─
    let settleTxSignature: string | null = null;
    let settleHostUsdc = 0;
    let settleRefundUsdc = refundUsdc;
    let settleTreasuryUsdc = 0;

    // Look up org wallet for the 85% payment
    let orgWalletAddress: string | null = null;
    if (ws.orgId) {
      try {
        const [org] = await db.select({ ownerWalletAddress: organizations.ownerWalletAddress })
          .from(organizations).where(eq(organizations.id, ws.orgId)).limit(1);
        orgWalletAddress = org?.ownerWalletAddress ?? null;
      } catch (e) {
        logger.warn({ err: e }, "[checkout] Org wallet lookup error");
      }
    }

    if (orgWalletAddress && walletAddr && escrowUsdc > 0) {
      // Atomic: vault → org (85%) + vault → user (refund) in one tx
      try {
        const settleRes = await fetch(`${MPC_SIDECAR}/mpc/escrow/settle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_wallet_address: walletAddr,
            booking_id: booking.id,
            deposit_usdc: escrowUsdc,
            planned_seconds: (booking.plannedDurationHours ?? 8) * 3600,
            duration_seconds: elapsedSeconds,
            org_wallet_address: orgWalletAddress,
          }),
        });
        if (settleRes.ok) {
          const sd = (await settleRes.json()) as {
            tx_signature?: string | null;
            host_amount_usdc?: number;
            treasury_amount_usdc?: number;
            refund_usdc?: number;
          };
          settleTxSignature    = sd.tx_signature ?? null;
          settleHostUsdc       = sd.host_amount_usdc ?? 0;
          settleTreasuryUsdc   = sd.treasury_amount_usdc ?? 0;
          settleRefundUsdc     = sd.refund_usdc ?? refundUsdc;
          logger.info({
            txSignature: settleTxSignature,
            orgUsdc: settleHostUsdc,
            treasuryUsdc: settleTreasuryUsdc,
            refundUsdc: settleRefundUsdc,
          }, "[checkout] Atomic settle succeeded");
        } else {
          const errBody = await settleRes.text();
          logger.warn({ errBody }, "[checkout] Escrow settle failed");
        }
      } catch (err) {
        logger.warn({ err }, "[checkout] Escrow settle error");
      }
    } else {
      // Fallback: no org wallet or no wallet addr — just refund user from vault
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
          console.warn("[checkout] Fallback vault-settle error:", err);
        }
      }
      logger.warn({ orgId: ws.orgId ?? "unknown" }, "[checkout] Org wallet missing — 85% kept in vault");
    }

    // Log vault 15% retention
    const vaultRetention = parseFloat((billedUsdc * 0.15).toFixed(6));
    logger.info({ vaultRetention, billedUsdc }, "[checkout] Vault retention applied");

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
            logger.info({ clientId: d.mqttClientId, sent }, "[MQTT] Check-out power OFF");
          }
          if (wsDevices.length === 0) {
            logger.info({ workspaceId: ws.id }, "[MQTT] No devices in workspace to power off");
          }
        } catch (e) {
          logger.warn({ err: e }, "[MQTT] check-out power command error");
        }
      })();
    }
  } catch (err) {
    logger.error({ err }, "[QR checkout]");
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
