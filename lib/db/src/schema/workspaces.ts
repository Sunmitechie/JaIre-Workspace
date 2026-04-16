import { pgTable, text, integer, real, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const workspaceTypeEnum = pgEnum("workspace_type", [
  "hot_desk",
  "private_suite",
  "meeting_room",
  "lounge",
]);

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  capacity: integer("capacity").notNull().default(1),
  hourlyRateNgn: real("hourly_rate_ngn").notNull(),
  hourlyRateUsdc: real("hourly_rate_usdc").notNull(),
  amenities: text("amenities").notNull().default("[]"),
  imageUrl: text("image_url"),
  isAvailable: boolean("is_available").notNull().default(true),
  workspaceType: workspaceTypeEnum("workspace_type").notNull().default("hot_desk"),
  floor: integer("floor").notNull().default(1),
  qrSecret: text("qr_secret"),
  orgId: text("org_id"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
