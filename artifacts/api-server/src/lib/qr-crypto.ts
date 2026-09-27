import { createHmac } from "crypto";

export const SLOT_WINDOW_MS = 10_000;

export type ParsedQR =
  | { type: "org"; org_id: string; slot_hash: string }
  | { type: "workspace"; workspace_id: string; slot_hash: string }
  | null;

export function currentSlot(): number {
  return Math.floor(Date.now() / SLOT_WINDOW_MS);
}

export function slotHash(secret: string, slot: number): string {
  return createHmac("sha256", secret).update(slot.toString()).digest("hex").slice(0, 16);
}

export function validateSlotHash(secret: string, incomingHash: string): boolean {
  const now = currentSlot();
  for (const slot of [now - 1, now, now + 1]) {
    if (slotHash(secret, slot) === incomingHash) return true;
  }
  return false;
}

export function parseQRData(qrData: string): ParsedQR {
  try {
    const decoded = Buffer.from(qrData, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (typeof parsed.o === "string" && typeof parsed.h === "string") {
      return { type: "org", org_id: parsed.o, slot_hash: parsed.h };
    }
    if (typeof parsed.w === "string" && typeof parsed.h === "string") {
      return { type: "workspace", workspace_id: parsed.w, slot_hash: parsed.h };
    }
    return null;
  } catch {
    return null;
  }
}
