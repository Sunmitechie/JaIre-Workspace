import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { devices, organizations } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import {
  publishCommand,
  publishSimulatedTelemetry,
  deviceEvents,
  isConnected,
} from "../services/mqtt";

const router = Router();
const JWT_SECRET = process.env["JWT_SECRET"] ?? "jaire-dev-secret";

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

async function resolveOrgId(email: string): Promise<string | null> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.ownerEmail, email))
    .limit(1);
  return org?.id ?? null;
}

// GET /api/devices — list all devices for this org
router.get("/", requireOrgAuth, async (req: Request, res: Response) => {
  const orgId = await resolveOrgId((req as any).orgEmail);
  if (!orgId) return res.status(404).json({ error: "Org not found" });

  const result = await db
    .select()
    .from(devices)
    .where(eq(devices.orgId, orgId));

  res.json(result);
});

// POST /api/devices — register a new device
router.post("/", requireOrgAuth, async (req: Request, res: Response) => {
  const orgId = await resolveOrgId((req as any).orgEmail);
  if (!orgId) return res.status(404).json({ error: "Org not found" });

  const { deviceName, deviceType, workspaceId, mqttClientId } = req.body;
  if (!deviceName || !mqttClientId)
    return res.status(400).json({ error: "deviceName and mqttClientId are required" });

  const [device] = await db
    .insert(devices)
    .values({
      orgId,
      workspaceId: workspaceId || null,
      deviceName,
      deviceType: deviceType ?? "smart_plug",
      mqttClientId,
    })
    .returning();

  res.json(device);
});

// DELETE /api/devices/:id — remove a device
router.delete("/:id", requireOrgAuth, async (req: Request, res: Response) => {
  const orgId = await resolveOrgId((req as any).orgEmail);
  if (!orgId) return res.status(404).json({ error: "Org not found" });

  await db
    .delete(devices)
    .where(and(eq(devices.id, req.params.id), eq(devices.orgId, orgId)));

  res.json({ success: true });
});

// POST /api/devices/:id/command — send on/off command to a physical device
router.post("/:id/command", requireOrgAuth, async (req: Request, res: Response) => {
  const orgId = await resolveOrgId((req as any).orgEmail);
  if (!orgId) return res.status(404).json({ error: "Org not found" });

  const { action } = req.body as { action: "on" | "off" };
  if (action !== "on" && action !== "off")
    return res.status(400).json({ error: "action must be 'on' or 'off'" });

  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.id, req.params.id), eq(devices.orgId, orgId)));

  if (!device) return res.status(404).json({ error: "Device not found" });

  const sent = publishCommand(orgId, device.mqttClientId, { action });

  // Optimistic state update even if MQTT is offline (for UI feedback)
  const [updated] = await db
    .update(devices)
    .set({ powerState: action === "on" })
    .where(eq(devices.id, req.params.id))
    .returning();

  // Emit so SSE clients update immediately
  deviceEvents.emit("update", {
    orgId,
    deviceClientId: device.mqttClientId,
    type: "command",
    data: { id: device.id, powerState: action === "on" },
  });

  res.json({ success: true, powerState: updated.powerState, mqttSent: sent });
});

// POST /api/devices/simulate — publish fake telemetry (manual testing without hardware)
router.post("/simulate", requireOrgAuth, async (req: Request, res: Response) => {
  const orgId = await resolveOrgId((req as any).orgEmail);
  if (!orgId) return res.status(404).json({ error: "Org not found" });

  const { mqttClientId, watts, voltage, amps, power_state, temperature } = req.body;
  if (!mqttClientId)
    return res.status(400).json({ error: "mqttClientId is required" });

  const payload = {
    watts: watts ?? 0,
    voltage: voltage ?? 220,
    amps: amps ?? 0,
    power_state: power_state ?? false,
    temperature: temperature ?? null,
    today_kwh: null,
  };

  const sent = publishSimulatedTelemetry(orgId, mqttClientId, payload);

  // Also directly update DB + emit event so it works even if MQTT broker is slow
  await db
    .update(devices)
    .set({
      isOnline: true,
      powerState: payload.power_state,
      currentWatts: payload.watts,
      voltage: payload.voltage,
      currentAmps: payload.amps,
      temperature: payload.temperature,
      lastSeen: new Date(),
    })
    .where(and(eq(devices.mqttClientId, mqttClientId), eq(devices.orgId, orgId)));

  deviceEvents.emit("update", {
    orgId,
    deviceClientId: mqttClientId,
    type: "telemetry",
    data: payload,
  });

  res.json({ success: true, mqttSent: sent, payload });
});

// GET /api/devices/status — MQTT broker connection status
router.get("/status", requireOrgAuth, (_req: Request, res: Response) => {
  res.json({ mqttConnected: isConnected() });
});

// GET /api/devices/events — SSE stream for real-time device updates
// Accepts token as ?token= query param since EventSource doesn't support custom headers
function requireOrgAuthOrQuery(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers["authorization"];
  const queryToken = req.query["token"] as string | undefined;
  const raw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : queryToken;
  if (!raw) { res.status(401).json({ error: "Missing auth token" }); return; }
  try {
    const payload = jwt.verify(raw, JWT_SECRET) as { email: string };
    (req as any).orgEmail = payload.email;
    next();
  } catch { res.status(401).json({ error: "Invalid token" }); }
}

router.get("/events", requireOrgAuthOrQuery, async (req: Request, res: Response) => {
  const orgId = await resolveOrgId((req as any).orgEmail);
  if (!orgId) return res.status(404).json({ error: "Org not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const handler = (event: any) => {
    if (event.orgId === orgId) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  deviceEvents.on("update", handler);

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 25000);

  req.on("close", () => {
    deviceEvents.off("update", handler);
    clearInterval(heartbeat);
  });
});

export default router;
