import { pgTable, text, real, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const paymentProviderEnum = pgEnum("payment_provider", [
  "paystack",
  "stripe",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "success",
  "failed",
  "abandoned",
]);

export const payments = pgTable("payments", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: text("booking_id"),
  userEmail: text("user_email").notNull(),
  userWalletAddress: text("user_wallet_address"),
  amountNgn: real("amount_ngn").notNull(),
  amountUsdc: real("amount_usdc").notNull(),
  fxRate: real("fx_rate").notNull().default(1600),
  fxSpreadPct: real("fx_spread_pct").notNull().default(0.5),
  reference: text("reference").notNull().unique(),
  provider: paymentProviderEnum("provider").notNull().default("paystack"),
  status: paymentStatusEnum("status").notNull().default("pending"),
  txSignature: text("tx_signature"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
