import { pgTable, text, integer, real, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspaces";

export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "active",
  "completed",
  "cancelled",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "paystack",
  "roqqu",
  "usdc_wallet",
]);

export const bookings = pgTable("bookings", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  userId: text("user_id").notNull().default("guest"),
  userName: text("user_name").notNull().default("Guest"),
  userEmail: text("user_email"),
  status: bookingStatusEnum("status").notNull().default("pending"),
  checkInTime: timestamp("check_in_time"),
  checkOutTime: timestamp("check_out_time"),
  plannedDurationHours: real("planned_duration_hours").notNull().default(1),
  actualDurationSeconds: integer("actual_duration_seconds"),
  escrowAmountUsdc: real("escrow_amount_usdc"),
  billedAmountUsdc: real("billed_amount_usdc"),
  refundedAmountUsdc: real("refunded_amount_usdc"),
  escrowAccount: text("escrow_account"),
  transactionSignature: text("transaction_signature"),
  escrowTxSignature: text("escrow_tx_signature"),
  settlementTxSignature: text("settlement_tx_signature"),
  paymentMethod: paymentMethodEnum("payment_method").notNull().default("paystack"),
  ngnAmountPaid: real("ngn_amount_paid"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
