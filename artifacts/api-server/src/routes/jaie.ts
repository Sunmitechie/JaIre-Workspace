import { Router } from "express";
import { db } from "@workspace/db";
import { organizations, workspaces, bookings } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { runJaieAgent, runJaieAgentStream, type OrgContext } from "../agents/jaie-agent.js";

const router = Router();
const JWT_SECRET = process.env["JWT_SECRET"] ?? "jaire-dev-secret";

function requireOrgAuth(req: any, res: any, next: () => void) {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing auth token" });
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { email: string };
    req.orgEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

async function buildOrgContext(email: string): Promise<OrgContext | undefined> {
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.ownerEmail, email)).limit(1);
    if (!org) return undefined;

    const orgWorkspaces = await db.select().from(workspaces).where(eq(workspaces.orgId, org.id));
    const wsIds = orgWorkspaces.map(w => w.id);

    let totalBookings = 0;
    let revenueUsdc = 0;
    let activeNow = 0;

    if (wsIds.length > 0) {
      const recentBookings = await db.select({
        status: bookings.status,
        billedUsdc: bookings.billedAmountUsdc,
      }).from(bookings)
        .where(sql`workspace_id = ANY(ARRAY[${sql.join(wsIds.map(id => sql`${id}`), sql`, `)}])`)
        .orderBy(desc(bookings.checkInTime))
        .limit(50);

      totalBookings = recentBookings.length;
      activeNow = recentBookings.filter(b => b.status === "active").length;
      revenueUsdc = recentBookings
        .filter(b => b.status === "completed" && b.billedUsdc)
        .reduce((sum, b) => sum + (b.billedUsdc ?? 0), 0);
    }

    return {
      orgName: org.businessName ?? org.ownerName ?? undefined,
      ownerEmail: org.ownerEmail,
      kycStatus: org.kycStatus,
      walletAddress: org.ownerWalletAddress ?? undefined,
      totalWorkspaces: orgWorkspaces.length,
      totalBookings,
      revenueUsdc: Math.round(revenueUsdc * 100) / 100,
      activeNow,
      workspaces: orgWorkspaces.map(w => ({
        name: w.name,
        type: w.workspaceType ?? "hot_desk",
        rateNgn: w.hourlyRateNgn,
        isAvailable: w.isAvailable ?? true,
      })),
    };
  } catch {
    return undefined;
  }
}

function sseHeaders(res: any) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
}

function sendEvent(res: any, data: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// POST /api/jaie/chat  — streaming SSE chat
router.post("/chat", requireOrgAuth, async (req: any, res: any) => {
  const { message, history } = req.body as {
    message?: string;
    history?: { role: "user" | "assistant"; content: string }[];
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  sseHeaders(res);

  try {
    const orgCtx = await buildOrgContext(req.orgEmail as string);
    let fullResponse = "";

    for await (const chunk of runJaieAgentStream(message, history ?? [], orgCtx)) {
      fullResponse += chunk;
      sendEvent(res, { type: "text", content: chunk });
    }

    sendEvent(res, { type: "done", full_response: fullResponse });
    res.end();
  } catch (err: any) {
    sendEvent(res, { type: "error", message: err?.message ?? "Jaie error" });
    res.end();
  }
});

// POST /api/jaie/message  — non-streaming fallback
router.post("/message", requireOrgAuth, async (req: any, res: any) => {
  const { message, history } = req.body as {
    message?: string;
    history?: { role: "user" | "assistant"; content: string }[];
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const orgCtx = await buildOrgContext(req.orgEmail as string);
    const response = await runJaieAgent(message, history ?? [], orgCtx);
    res.json({ response });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Jaie error" });
  }
});

export default router;
