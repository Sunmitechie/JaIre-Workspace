import { Router } from "express";
import { db } from "@workspace/db";
import { bookings, workspaces, activityEvents } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  ListBookingsQueryParams,
  CreateBookingBody,
  GetBookingParams,
  CheckoutBookingParams,
  GetBookingStatusParams,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";
import { serializeBooking } from "../lib/serialize";

const router = Router();

const NGN_PER_USDC = 1600;

router.get("/", async (req, res) => {
  try {
    const query = ListBookingsQueryParams.safeParse(req.query);
    let rows = await db
      .select()
      .from(bookings)
      .orderBy(desc(bookings.createdAt))
      .limit(query.success ? (query.data.limit ?? 20) : 20);

    if (query.success && query.data.status) {
      rows = rows.filter((b) => b.status === query.data.status);
    }

    const wsIds = [...new Set(rows.map((b) => b.workspaceId))];
    const wsNames: Record<string, string> = {};
    for (const id of wsIds) {
      const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, id));
      if (ws) wsNames[id] = ws.name;
    }

    res.json(rows.map((b) => serializeBooking(b, wsNames[b.workspaceId])));
  } catch (err) {
    res.status(500).json({ error: "Failed to list bookings" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = CreateBookingBody.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Invalid request", details: body.error.flatten() });
    }

    const { workspace_id, planned_duration_hours, payment_method, user_email, user_name } = body.data;

    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspace_id));

    if (!ws) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    const escrowUsdc = ws.hourly_rate_usdc * planned_duration_hours;
    const ngnPaid = ws.hourly_rate_ngn * planned_duration_hours;
    const bookingId = randomUUID();

    const [booking] = await db
      .insert(bookings)
      .values({
        id: bookingId,
        workspaceId: workspace_id,
        userId: "guest",
        userName: user_name ?? "Guest",
        userEmail: user_email,
        status: "active",
        checkInTime: new Date(),
        plannedDurationHours: planned_duration_hours,
        escrowAmountUsdc: escrowUsdc,
        paymentMethod: (payment_method ?? "paystack") as "paystack" | "roqqu" | "usdc_wallet",
        ngnAmountPaid: ngnPaid,
      })
      .returning();

    await db.insert(activityEvents).values({
      id: randomUUID(),
      eventType: "check_in",
      workspaceId: workspace_id,
      workspaceName: ws.name,
      userId: "guest",
      userName: user_name ?? "Guest",
      amountUsdc: null,
      amountNgn: null,
    });

    await db.insert(activityEvents).values({
      id: randomUUID(),
      eventType: "payment",
      workspaceId: workspace_id,
      workspaceName: ws.name,
      userId: "guest",
      userName: user_name ?? "Guest",
      amountUsdc: escrowUsdc,
      amountNgn: ngnPaid,
    });

    res.status(201).json(serializeBooking(booking, ws.name));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create booking" });
  }
});

router.get("/:bookingId", async (req, res) => {
  try {
    const params = GetBookingParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, params.data.bookingId));

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const [ws] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, booking.workspaceId));

    res.json(serializeBooking(booking, ws?.name));
  } catch (err) {
    res.status(500).json({ error: "Failed to get booking" });
  }
});

router.post("/:bookingId/checkout", async (req, res) => {
  try {
    const params = CheckoutBookingParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, params.data.bookingId));

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.status !== "active") {
      return res.status(400).json({ error: "Booking is not active" });
    }

    const checkInTime = booking.checkInTime ?? new Date();
    const checkOutTime = new Date();
    const elapsedMs = checkOutTime.getTime() - checkInTime.getTime();
    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, booking.workspaceId));

    const perSecondUsdc = (ws?.hourly_rate_usdc ?? 0) / 3600;
    const billedUsdc = parseFloat((perSecondUsdc * elapsedSeconds).toFixed(6));
    const escrowed = booking.escrowAmountUsdc ?? 0;
    const refundedUsdc = parseFloat(Math.max(0, escrowed - billedUsdc).toFixed(6));

    const yieldUsdc = parseFloat((billedUsdc * 0.05 * (elapsedSeconds / 31536000)).toFixed(8));

    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const secs = elapsedSeconds % 60;
    const durationDisplay = `${hours}h ${minutes}m ${secs}s`;

    const [updated] = await db
      .update(bookings)
      .set({
        status: "completed",
        checkOutTime,
        actualDurationSeconds: elapsedSeconds,
        billedAmountUsdc: billedUsdc,
        refundedAmountUsdc: refundedUsdc,
      })
      .where(eq(bookings.id, params.data.bookingId))
      .returning();

    await db.insert(activityEvents).values({
      id: randomUUID(),
      eventType: "check_out",
      workspaceId: booking.workspaceId,
      workspaceName: ws?.name,
      userId: booking.userId,
      userName: booking.userName,
      amountUsdc: billedUsdc,
      amountNgn: billedUsdc * NGN_PER_USDC,
    });

    res.json({
      booking_id: params.data.bookingId,
      workspace_name: ws?.name ?? booking.workspaceId,
      duration_seconds: elapsedSeconds,
      duration_display: durationDisplay,
      billed_usdc: billedUsdc,
      refunded_usdc: refundedUsdc,
      yield_earned_usdc: yieldUsdc,
      transaction_signature: null,
      check_in_time: checkInTime.toISOString(),
      check_out_time: checkOutTime.toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to checkout" });
  }
});

router.get("/:bookingId/status", async (req, res) => {
  try {
    const params = GetBookingStatusParams.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, params.data.bookingId));

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, booking.workspaceId));

    const checkInTime = booking.checkInTime ?? new Date();
    const now = new Date();
    const elapsedSeconds = booking.status === "active"
      ? Math.floor((now.getTime() - checkInTime.getTime()) / 1000)
      : (booking.actualDurationSeconds ?? 0);

    const perSecondUsdc = (ws?.hourly_rate_usdc ?? 0) / 3600;
    const currentCostUsdc = parseFloat((perSecondUsdc * elapsedSeconds).toFixed(6));
    const currentCostNgn = parseFloat((currentCostUsdc * NGN_PER_USDC).toFixed(2));

    const plannedSeconds = Math.floor((booking.plannedDurationHours ?? 1) * 3600);

    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const secs = elapsedSeconds % 60;
    const elapsedDisplay = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;

    res.json({
      booking_id: params.data.bookingId,
      workspace_id: booking.workspaceId,
      workspace_name: ws?.name ?? booking.workspaceId,
      status: booking.status,
      elapsed_seconds: elapsedSeconds,
      planned_seconds: plannedSeconds,
      elapsed_display: elapsedDisplay,
      current_cost_usdc: currentCostUsdc,
      current_cost_ngn: currentCostNgn,
      escrowed_usdc: booking.escrowAmountUsdc ?? 0,
      check_in_time: checkInTime.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get booking status" });
  }
});

export default router;
