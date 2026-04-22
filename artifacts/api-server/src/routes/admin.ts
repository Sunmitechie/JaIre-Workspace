/**
 * JaIre Platform Admin API
 *
 * Protected endpoints for JaIre founders (Bare) to monitor the full platform.
 * Auth: Authorization: Bearer <JAIRE_ADMIN_TOKEN>  or  ?admin_key=<token>
 *
 * Routes
 * ──────
 *  GET  /api/admin/overview       — Platform-wide metrics + vault balance
 *  GET  /api/admin/organizations  — All orgs with workspace + revenue stats
 *  GET  /api/admin/bookings       — Recent bookings across all orgs
 *  GET  /api/admin/activity       — Global activity feed
 *  PATCH /api/admin/organizations/:id/kyc  — Approve / reject KYC
 */

import { Router, Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import {
  organizations,
  workspaces,
  bookings,
  activityEvents,
  users,
} from "@workspace/db";
import { eq, desc, gte, sql } from "drizzle-orm";

const router = Router();

const MPC_SIDECAR = process.env["MPC_SIDECAR_URL"] ?? "http://localhost:9000";
const NGN_PER_USDC = 1600;

// ── Auth middleware ────────────────────────────────────────────────────────
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const adminToken = process.env["JAIRE_ADMIN_TOKEN"];
  if (!adminToken) {
    // No token configured — allow in dev (log a warning)
    console.warn("[admin] JAIRE_ADMIN_TOKEN not set — admin endpoints are OPEN");
    return next();
  }

  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  const query  = (req.query["admin_key"] as string | undefined) ?? null;
  const token  = bearer ?? query;

  if (token !== adminToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ── GET /api/admin/overview ────────────────────────────────────────────────
router.get("/overview", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [
      allOrgs,
      allWorkspaces,
      allBookings,
      allUsers,
    ] = await Promise.all([
      db.select().from(organizations),
      db.select().from(workspaces),
      db.select().from(bookings),
      db.select({ count: sql<number>`count(*)::int` }).from(users),
    ]);

    const activeSessions = allBookings.filter((b) => b.status === "active");
    const completedBookings = allBookings.filter((b) => b.status === "completed");

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayBookings = allBookings.filter(
      (b) => b.checkInTime && new Date(b.checkInTime) >= today,
    );

    const totalRevenueUsdc = completedBookings.reduce(
      (sum, b) => sum + (b.billedAmountUsdc ?? 0), 0,
    );
    const platformFeeUsdc = totalRevenueUsdc * 0.15;
    const totalEscrowUsdc = allBookings
      .filter((b) => b.status === "active")
      .reduce((sum, b) => sum + (b.escrowAmountUsdc ?? 0), 0);

    // Fetch vault balance from MPC sidecar
    let vaultBalanceUsdc = 0;
    let vaultSol = 0;
    let vaultAddress = "";
    try {
      const vaultRes = await fetch(`${MPC_SIDECAR}/mpc/vault-address`);
      if (vaultRes.ok) {
        const vd = (await vaultRes.json()) as { vault_address?: string };
        vaultAddress = vd.vault_address ?? "";
        if (vaultAddress) {
          const balRes = await fetch(`${MPC_SIDECAR}/mpc/balance/${vaultAddress}`);
          if (balRes.ok) {
            const bd = (await balRes.json()) as {
              usdc_balance?: number;
              sol_balance?: number;
            };
            vaultBalanceUsdc = bd.usdc_balance ?? 0;
            vaultSol = bd.sol_balance ?? 0;
          }
        }
      }
    } catch (e) {
      console.warn("[admin/overview] vault balance fetch failed:", e);
    }

    const kycCounts = { pending: 0, submitted: 0, verified: 0, rejected: 0 };
    allOrgs.forEach((o) => {
      kycCounts[(o.kycStatus as keyof typeof kycCounts)] =
        (kycCounts[(o.kycStatus as keyof typeof kycCounts)] ?? 0) + 1;
    });

    res.json({
      total_organizations:   allOrgs.length,
      total_workspaces:      allWorkspaces.length,
      total_bookings:        allBookings.length,
      total_users:           allUsers[0]?.count ?? 0,
      active_sessions:       activeSessions.length,
      today_checkins:        todayBookings.length,
      total_revenue_usdc:    parseFloat(totalRevenueUsdc.toFixed(6)),
      platform_fee_usdc:     parseFloat(platformFeeUsdc.toFixed(6)),
      total_escrow_usdc:     parseFloat(totalEscrowUsdc.toFixed(6)),
      total_revenue_ngn:     parseFloat((totalRevenueUsdc * NGN_PER_USDC).toFixed(2)),
      vault_balance_usdc:    parseFloat(vaultBalanceUsdc.toFixed(6)),
      vault_sol:             parseFloat(vaultSol.toFixed(6)),
      vault_address:         vaultAddress,
      kyc_counts:            kycCounts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ── GET /api/admin/organizations ───────────────────────────────────────────
router.get("/organizations", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [allOrgs, allWorkspaces, allBookings] = await Promise.all([
      db.select().from(organizations).orderBy(desc(organizations.createdAt)),
      db.select().from(workspaces),
      db.select().from(bookings),
    ]);

    const orgsWithStats = allOrgs.map((org) => {
      const orgWorkspaces = allWorkspaces.filter((w) => w.orgId === org.id);
      const wsIds = orgWorkspaces.map((w) => w.id);
      const orgBookings = allBookings.filter((b) => wsIds.includes(b.workspaceId ?? ""));
      const completedBookings = orgBookings.filter((b) => b.status === "completed");
      const revenueUsdc = completedBookings.reduce(
        (sum, b) => sum + (b.billedAmountUsdc ?? 0), 0,
      );
      return {
        id:               org.id,
        business_name:    org.businessName ?? org.ownerEmail,
        owner_name:       org.ownerName,
        owner_email:      org.ownerEmail,
        owner_wallet:     org.ownerWalletAddress,
        kyc_status:       org.kycStatus,
        org_type:         org.orgType,
        country:          org.country,
        state:            org.state,
        phone:            org.phone,
        website:          org.website,
        workspace_count:  orgWorkspaces.length,
        booking_count:    orgBookings.length,
        active_sessions:  orgBookings.filter((b) => b.status === "active").length,
        revenue_usdc:     parseFloat(revenueUsdc.toFixed(6)),
        revenue_ngn:      parseFloat((revenueUsdc * NGN_PER_USDC).toFixed(2)),
        created_at:       org.createdAt,
        kyc_submitted_at: org.kycSubmittedAt,
        kyc_verified_at:  org.kycVerifiedAt,
      };
    });

    res.json({ organizations: orgsWithStats, total: orgsWithStats.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ── GET /api/admin/bookings ────────────────────────────────────────────────
router.get("/bookings", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit  = Math.min(parseInt((req.query["limit"] as string) ?? "50"), 200);
    const status = (req.query["status"] as string | undefined) ?? undefined;

    let query = db
      .select({
        id:                  bookings.id,
        workspace_id:        bookings.workspaceId,
        workspace_name:      workspaces.name,
        org_id:              workspaces.orgId,
        user_id:             bookings.userId,
        user_name:           bookings.userName,
        user_email:          bookings.userEmail,
        status:              bookings.status,
        check_in_time:       bookings.checkInTime,
        check_out_time:      bookings.checkOutTime,
        planned_hours:       bookings.plannedDurationHours,
        actual_seconds:      bookings.actualDurationSeconds,
        escrow_usdc:         bookings.escrowAmountUsdc,
        billed_usdc:         bookings.billedAmountUsdc,
        refunded_usdc:       bookings.refundedAmountUsdc,
        payment_method:      bookings.paymentMethod,
        escrow_tx:           bookings.escrowTxSignature,
        settle_tx:           bookings.settlementTxSignature,
        created_at:          bookings.createdAt,
      })
      .from(bookings)
      .leftJoin(workspaces, eq(bookings.workspaceId, workspaces.id))
      .orderBy(desc(bookings.createdAt))
      .limit(limit);

    const rows = await query;
    const filtered = status ? rows.filter((r) => r.status === status) : rows;

    res.json({ bookings: filtered, total: filtered.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ── GET /api/admin/activity ────────────────────────────────────────────────
router.get("/activity", requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt((req.query["limit"] as string) ?? "30"), 100);
    const events = await db
      .select()
      .from(activityEvents)
      .orderBy(desc(activityEvents.createdAt))
      .limit(limit);

    res.json({ events, total: events.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ── PATCH /api/admin/organizations/:id/kyc ────────────────────────────────
router.patch("/organizations/:id/kyc", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status?: string };

    if (!status || !["verified", "rejected", "pending", "submitted"].includes(status)) {
      res.status(400).json({ error: "status must be verified | rejected | pending | submitted" });
      return;
    }

    const [updated] = await db
      .update(organizations)
      .set({
        kycStatus:     status as "verified" | "rejected" | "pending" | "submitted",
        kycVerifiedAt: status === "verified" ? new Date() : undefined,
        updatedAt:     new Date(),
      })
      .where(eq(organizations.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    console.log(`[admin] KYC ${status} for org ${id}`);
    res.json({ success: true, organization: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
