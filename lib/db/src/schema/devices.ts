import { pgTable, text, boolean, real, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const devices = pgTable("devices", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: text("org_id").notNull(),
  workspaceId: text("workspace_id"),
  deviceName: text("device_name").notNull(),
  deviceType: text("device_type").notNull().default("smart_plug"),
  mqttClientId: text("mqtt_client_id").notNull(),
  isOnline: boolean("is_online").default(false),
  powerState: boolean("power_state").default(false),
  currentWatts: real("current_watts"),
  voltage: real("voltage"),
  currentAmps: real("current_amps"),
  todayKwh: real("today_kwh").default(0),
  temperature: real("temperature"),
  lastSeen: timestamp("last_seen"),
  createdAt: timestamp("created_at").defaultNow(),
});
