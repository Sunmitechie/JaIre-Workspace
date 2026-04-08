import { pgTable, text, real, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const eventTypeEnum = pgEnum("event_type", [
  "check_in",
  "check_out",
  "payment",
  "wallet_funded",
  "booking_cancelled",
]);

export const activityEvents = pgTable("activity_events", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: eventTypeEnum("event_type").notNull(),
  workspaceId: text("workspace_id"),
  workspaceName: text("workspace_name"),
  userId: text("user_id"),
  userName: text("user_name"),
  amountUsdc: real("amount_usdc"),
  amountNgn: real("amount_ngn"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export type ActivityEvent = typeof activityEvents.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;
