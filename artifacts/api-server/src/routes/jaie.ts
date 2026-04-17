import { Router } from "express";
import { db } from "@workspace/db";
import { organizations, workspaces, bookings } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { runJaieAgent, runJaieAgentStream, type OrgContext, type JaieToolImplementations } from "../agents/jaie-agent.js";

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

async function buildOrgContext(email: string): Promise<{ ctx: OrgContext | undefined; orgId: string | undefined }> {
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.ownerEmail, email)).limit(1);
    if (!org) return { ctx: undefined, orgId: undefined };

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

    const ctx: OrgContext = {
      orgName: org.businessName ?? org.ownerName ?? undefined,
      ownerEmail: org.ownerEmail,
      kycStatus: org.kycStatus,
      walletAddress: org.ownerWalletAddress ?? undefined,
      totalWorkspaces: orgWorkspaces.length,
      totalBookings,
      revenueUsdc: Math.round(revenueUsdc * 100) / 100,
      activeNow,
      workspaces: orgWorkspaces.map(w => ({
        id: w.id,
        name: w.name,
        type: w.workspaceType ?? "hot_desk",
        rateNgn: w.hourlyRateNgn,
        isAvailable: w.isAvailable ?? true,
      })),
    };

    return { ctx, orgId: org.id };
  } catch {
    return { ctx: undefined, orgId: undefined };
  }
}

function buildToolImpls(orgId: string): JaieToolImplementations {
  return {
    toggleWorkspaceAvailability: async (workspaceId: string, available: boolean) => {
      try {
        const [ws] = await db.select().from(workspaces)
          .where(eq(workspaces.id, workspaceId)).limit(1);

        if (!ws || ws.orgId !== orgId) {
          return `Workspace not found or not yours.`;
        }

        await db.update(workspaces)
          .set({ isAvailable: available })
          .where(eq(workspaces.id, workspaceId));

        return `Done — "${ws.name}" is now ${available ? "available for booking" : "offline"}. The dashboard will reflect this change.`;
      } catch (err) {
        return `Failed to update workspace: ${err instanceof Error ? err.message : String(err)}`;
      }
    },

    getBookingDetails: async (workspaceId: string) => {
      try {
        const [ws] = await db.select().from(workspaces)
          .where(eq(workspaces.id, workspaceId)).limit(1);

        if (!ws || ws.orgId !== orgId) return "Workspace not found.";

        const recentBookings = await db.select({
          id: bookings.id,
          status: bookings.status,
          billedUsdc: bookings.billedAmountUsdc,
          checkIn: bookings.checkInTime,
        }).from(bookings)
          .where(eq(bookings.workspaceId, workspaceId))
          .orderBy(desc(bookings.checkInTime))
          .limit(10);

        const completed = recentBookings.filter(b => b.status === "completed");
        const active = recentBookings.filter(b => b.status === "active");
        const totalRevenue = completed.reduce((s, b) => s + (b.billedUsdc ?? 0), 0);

        return `"${ws.name}" — ${completed.length} completed sessions, $${totalRevenue.toFixed(2)} USDC revenue, ${active.length} active now, ${recentBookings.length} total recent bookings.`;
      } catch (err) {
        return `Failed to get booking details: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
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

// POST /api/jaie/chat  — streaming SSE chat with tool support
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
    const { ctx: orgCtx, orgId } = await buildOrgContext(req.orgEmail as string);
    const toolImpls = orgId ? buildToolImpls(orgId) : undefined;
    let fullResponse = "";

    for await (const chunk of runJaieAgentStream(message, history ?? [], orgCtx, toolImpls)) {
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

// POST /api/jaie/message  — non-streaming fallback with tool support
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
    const { ctx: orgCtx, orgId } = await buildOrgContext(req.orgEmail as string);
    const toolImpls = orgId ? buildToolImpls(orgId) : undefined;
    const response = await runJaieAgent(message, history ?? [], orgCtx, toolImpls);
    res.json({ response });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Jaie error" });
  }
});

export default router;
