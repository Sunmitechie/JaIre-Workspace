import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { organizations, workspaces, bookings } from "@workspace/db";
import { eq, and, desc, count, sql } from "drizzle-orm";
import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env["JWT_SECRET"] ?? "jaire-dev-secret";

// ── Auth middleware (reuses user JWT but checks org ownership) ──────────────
function requireOrgAuth(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing auth token" });
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as {
      email: string;
      orgId?: string;
    };
    (req as any).orgEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ── POST /api/org/signup ─────────────────────────────────────────────────────
// Create org account (called after Web3Auth login on org side)
router.post("/signup", async (req: Request, res: Response) => {
  const { email, name, verifier_id, wallet_address } = req.body as {
    email?: string;
    name?: string;
    verifier_id?: string;
    wallet_address?: string;
  };

  if (!email) { res.status(400).json({ error: "email required" }); return; }

  try {
    const existing = await db.select().from(organizations).where(eq(organizations.ownerEmail, email)).limit(1);

    if (existing.length > 0) {
      // Already exists — return current state
      const token = jwt.sign({ email, orgId: existing[0].id }, JWT_SECRET, { expiresIn: "7d" });
      res.json({ org: existing[0], token, created: false });
      return;
    }

    const [org] = await db.insert(organizations).values({
      ownerEmail: email,
      ownerName: name,
      ownerVerifierId: verifier_id,
      ownerWalletAddress: wallet_address,
      kycStatus: "pending",
    }).returning();

    const token = jwt.sign({ email, orgId: org.id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ org, token, created: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[org/signup]", message);
    res.status(500).json({ error: message });
  }
});

// ── POST /api/org/kyc ────────────────────────────────────────────────────────
// Submit KYC information
router.post("/kyc", requireOrgAuth, async (req: Request, res: Response) => {
  const email = (req as any).orgEmail as string;
  const {
    business_name, org_type, registration_number,
    country, state, address, website, description, phone, logo_url,
  } = req.body as Record<string, string>;

  if (!business_name) { res.status(400).json({ error: "business_name required" }); return; }

  try {
    const [updated] = await db.update(organizations).set({
      businessName: business_name,
      orgType: (org_type ?? "coworking_space") as any,
      registrationNumber: registration_number,
      country: country ?? "Nigeria",
      state,
      address,
      website,
      description,
      phone,
      logoUrl: logo_url,
      kycStatus: "submitted",
      kycSubmittedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(organizations.ownerEmail, email)).returning();

    if (!updated) { res.status(404).json({ error: "Org not found" }); return; }
    res.json({ org: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[org/kyc]", message);
    res.status(500).json({ error: message });
  }
});

// ── GET /api/org/me ──────────────────────────────────────────────────────────
router.get("/me", requireOrgAuth, async (req: Request, res: Response) => {
  const email = (req as any).orgEmail as string;
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.ownerEmail, email)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }
    res.json({ org });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/org/dashboard ───────────────────────────────────────────────────
// Aggregate metrics for the org's workspaces
router.get("/dashboard", requireOrgAuth, async (req: Request, res: Response) => {
  const email = (req as any).orgEmail as string;

  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.ownerEmail, email)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    const orgWorkspaces = await db.select().from(workspaces).where(eq(workspaces.orgId, org.id));
    const wsIds = orgWorkspaces.map((w) => w.id);

    if (wsIds.length === 0) {
      res.json({ org, workspaces: [], metrics: { total_bookings: 0, active_now: 0, revenue_usdc: 0 }, recent_bookings: [] });
      return;
    }

    // Recent bookings across all org workspaces
    const recentBookings = await db.select({
      id: bookings.id,
      workspaceId: bookings.workspaceId,
      status: bookings.status,
      startTime: bookings.checkInTime,
      endTime: bookings.checkOutTime,
      billedUsdc: bookings.billedAmountUsdc,
      escrowTxSignature: bookings.escrowTxSignature,
    }).from(bookings)
      .where(sql`workspace_id = ANY(ARRAY[${sql.join(wsIds.map(id => sql`${id}`), sql`, `)}])`)
      .orderBy(desc(bookings.checkInTime))
      .limit(20);

    // Metrics
    const totalBookings = recentBookings.length;
    const activeNow = recentBookings.filter(b => b.status === "active").length;
    const revenueUsdc = recentBookings
      .filter(b => b.status === "completed" && b.billedUsdc)
      .reduce((sum, b) => sum + (b.billedUsdc ?? 0), 0);

    res.json({
      org,
      workspaces: orgWorkspaces,
      metrics: {
        total_workspaces: orgWorkspaces.length,
        total_bookings: totalBookings,
        active_now: activeNow,
        revenue_usdc: Math.round(revenueUsdc * 100) / 100,
      },
      recent_bookings: recentBookings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[org/dashboard]", message);
    res.status(500).json({ error: message });
  }
});

// ── GET /api/org/workspaces ──────────────────────────────────────────────────
router.get("/workspaces", requireOrgAuth, async (req: Request, res: Response) => {
  const email = (req as any).orgEmail as string;
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.ownerEmail, email)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    const ws = await db.select().from(workspaces).where(eq(workspaces.orgId, org.id));
    res.json({ workspaces: ws });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/org/workspaces ─────────────────────────────────────────────────
router.post("/workspaces", requireOrgAuth, async (req: Request, res: Response) => {
  const email = (req as any).orgEmail as string;
  const {
    name, description, capacity, hourly_rate_ngn,
    workspace_type, floor, amenities, image_url,
  } = req.body as Record<string, any>;

  if (!name || !hourly_rate_ngn) {
    res.status(400).json({ error: "name and hourly_rate_ngn required" });
    return;
  }

  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.ownerEmail, email)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }
    if (org.kycStatus !== "verified" && org.kycStatus !== "submitted") {
      res.status(403).json({ error: "KYC must be submitted before adding workspaces" });
      return;
    }

    const USDC_RATE = 1608;
    const hourlyRateNgn = Number(hourly_rate_ngn);
    const hourlyRateUsdc = hourlyRateNgn / USDC_RATE;
    const wsId = `ws-${org.id.slice(0, 6)}-${Date.now()}`;

    const [ws] = await db.insert(workspaces).values({
      id: wsId,
      name,
      description: description ?? "",
      capacity: Number(capacity ?? 1),
      hourlyRateNgn,
      hourlyRateUsdc,
      workspaceType: workspace_type ?? "hot_desk",
      floor: Number(floor ?? 1),
      amenities: JSON.stringify(amenities ?? []),
      imageUrl: image_url,
      isAvailable: true,
      orgId: org.id,
    }).returning();

    res.json({ workspace: ws });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[org/workspaces POST]", message);
    res.status(500).json({ error: message });
  }
});

// ── PATCH /api/org/workspaces/:id ────────────────────────────────────────────
router.patch("/workspaces/:id", requireOrgAuth, async (req: Request, res: Response) => {
  const email = (req as any).orgEmail as string;
  const wsId = req.params["id"];

  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.ownerEmail, email)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    const [ws] = await db.select().from(workspaces)
      .where(and(eq(workspaces.id, wsId), eq(workspaces.orgId, org.id))).limit(1);
    if (!ws) { res.status(404).json({ error: "Workspace not found or not yours" }); return; }

    const { name, description, capacity, hourly_rate_ngn, is_available, amenities, image_url } = req.body as Record<string, any>;
    const USDC_RATE = 1608;

    const [updated] = await db.update(workspaces).set({
      ...(name ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(capacity !== undefined ? { capacity: Number(capacity) } : {}),
      ...(hourly_rate_ngn !== undefined ? {
        hourlyRateNgn: Number(hourly_rate_ngn),
        hourlyRateUsdc: Number(hourly_rate_ngn) / USDC_RATE,
      } : {}),
      ...(is_available !== undefined ? { isAvailable: Boolean(is_available) } : {}),
      ...(amenities !== undefined ? { amenities: JSON.stringify(amenities) } : {}),
      ...(image_url !== undefined ? { imageUrl: image_url } : {}),
    }).where(eq(workspaces.id, wsId)).returning();

    res.json({ workspace: updated });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── DELETE /api/org/workspaces/:id ───────────────────────────────────────────
router.delete("/workspaces/:id", requireOrgAuth, async (req: Request, res: Response) => {
  const email = (req as any).orgEmail as string;
  const wsId = req.params["id"];

  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.ownerEmail, email)).limit(1);
    if (!org) { res.status(404).json({ error: "Org not found" }); return; }

    const [ws] = await db.select().from(workspaces)
      .where(and(eq(workspaces.id, wsId), eq(workspaces.orgId, org.id))).limit(1);
    if (!ws) { res.status(404).json({ error: "Workspace not found or not yours" }); return; }

    await db.update(workspaces).set({ isAvailable: false }).where(eq(workspaces.id, wsId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
