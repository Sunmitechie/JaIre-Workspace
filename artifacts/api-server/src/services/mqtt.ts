import mqtt from "mqtt";
import { EventEmitter } from "events";
import { db } from "@workspace/db";
import { devices } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export const deviceEvents = new EventEmitter();
deviceEvents.setMaxListeners(100);

const BROKER = "mqtt://broker.hivemq.com:1883";
let client: mqtt.MqttClient | null = null;
let connected = false;

export function initMqtt() {
  client = mqtt.connect(BROKER, {
    clientId: `jaire-server-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on("connect", () => {
    connected = true;
    console.log("[MQTT] Connected to HiveMQ public broker");
    client!.subscribe("jaire/devices/+/+/telemetry", { qos: 0 });
    client!.subscribe("jaire/devices/+/+/status", { qos: 0 });
  });

  client.on("reconnect", () => {
    console.log("[MQTT] Reconnecting...");
  });

  client.on("disconnect", () => {
    connected = false;
  });

  client.on("message", async (topic, payload) => {
    const parts = topic.split("/");
    if (parts.length < 5) return;
    const [, , orgId, deviceClientId, msgType] = parts;

    try {
      const data = JSON.parse(payload.toString());

      if (msgType === "telemetry") {
        await db
          .update(devices)
          .set({
            isOnline: true,
            powerState: data.power_state ?? false,
            currentWatts: data.watts ?? null,
            voltage: data.voltage ?? null,
            currentAmps: data.amps ?? null,
            temperature: data.temperature ?? null,
            todayKwh: data.today_kwh ?? undefined,
            lastSeen: new Date(),
          })
          .where(eq(devices.mqttClientId, deviceClientId));

        deviceEvents.emit("update", {
          orgId,
          deviceClientId,
          type: "telemetry",
          data,
        });
      } else if (msgType === "status") {
        const isOnline = data.status === "online";
        await db
          .update(devices)
          .set({ isOnline, lastSeen: new Date() })
          .where(eq(devices.mqttClientId, deviceClientId));

        deviceEvents.emit("update", {
          orgId,
          deviceClientId,
          type: "status",
          data: { isOnline },
        });
      }
    } catch (err: any) {
      console.error("[MQTT] Error processing message:", err.message);
    }
  });

  client.on("error", (err) => {
    console.error("[MQTT] Error:", err.message);
  });
}

export function isConnected() {
  return connected;
}

export function publishCommand(
  orgId: string,
  deviceClientId: string,
  command: { action: "on" | "off" },
) {
  if (!client?.connected) return false;
  client.publish(
    `jaire/devices/${orgId}/${deviceClientId}/command`,
    JSON.stringify(command),
  );
  return true;
}

export function publishSimulatedTelemetry(
  orgId: string,
  deviceClientId: string,
  data: Record<string, unknown>,
) {
  if (!client?.connected) {
    console.warn("[MQTT] Not connected — cannot publish simulated telemetry");
    return false;
  }
  client.publish(
    `jaire/devices/${orgId}/${deviceClientId}/telemetry`,
    JSON.stringify(data),
  );
  return true;
}
