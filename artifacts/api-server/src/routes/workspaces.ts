import { Router } from "express";
import { db } from "@workspace/db";
import { workspaces } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListWorkspacesQueryParams,
  GetWorkspaceParams,
  GetWorkspaceAvailabilityParams,
  GetWorkspaceAvailabilityQueryParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const query = ListWorkspacesQueryParams.safeParse(req.query);
    const all = await db.select().from(workspaces);

    let filtered = all.map((ws) => ({
      id: ws.id,
      name: ws.name,
      description: ws.description,
      capacity: ws.capacity,
      hourly_rate_ngn: ws.hourlyRateNgn,
      hourly_rate_usdc: ws.hourlyRateUsdc,
      amenities: JSON.parse(ws.amenities) as string[],
      image_url: ws.imageUrl,
      is_available: ws.isAvailable,
      workspace_type: ws.workspaceType,
      floor: ws.floor,
      current_occupant_count: 0,
    }));

    if (query.success) {
      const { min_rate, max_rate } = query.data;
      if (min_rate !== undefined) {
        filtered = filtered.filter((ws) => ws.hourly_rate_ngn >= min_rate);
      }
      if (max_rate !== undefined) {
        filtered = filtered.filter((ws) => ws.hourly_rate_ngn <= max_rate);
      }
    }

    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: "Failed to list workspaces" });
  }
});

router.get("/:workspaceId", async (req, res) => {
  try {
    const params = GetWorkspaceParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: "Invalid workspace ID" });
    }

    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, params.data.workspaceId));

    if (!ws) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    res.json({
      id: ws.id,
      name: ws.name,
      description: ws.description,
      capacity: ws.capacity,
      hourly_rate_ngn: ws.hourlyRateNgn,
      hourly_rate_usdc: ws.hourlyRateUsdc,
      amenities: JSON.parse(ws.amenities) as string[],
      image_url: ws.imageUrl,
      is_available: ws.isAvailable,
      workspace_type: ws.workspaceType,
      floor: ws.floor,
      current_occupant_count: 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get workspace" });
  }
});

router.get("/:workspaceId/availability", async (req, res) => {
  try {
    const params = GetWorkspaceAvailabilityParams.safeParse(req.params);
    const query = GetWorkspaceAvailabilityQueryParams.safeParse(req.query);

    if (!params.success || !query.success) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, params.data.workspaceId));

    if (!ws) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    const date = new Date(query.data.date);
    const slots = [];

    for (let hour = 7; hour < 22; hour++) {
      const start = new Date(date);
      start.setHours(hour, 0, 0, 0);
      const end = new Date(date);
      end.setHours(hour + 1, 0, 0, 0);

      slots.push({
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        is_available: Math.random() > 0.2,
      });
    }

    res.json(slots);
  } catch (err) {
    res.status(500).json({ error: "Failed to get availability" });
  }
});

export default router;
