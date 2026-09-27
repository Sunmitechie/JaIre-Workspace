import { describe, expect, it } from "vitest";
import { currentSlot, parseQRData, slotHash, validateSlotHash } from "../src/lib/qr-crypto";

describe("qr-crypto helpers", () => {
  it("accepts a live slot hash within the valid window", () => {
    const secret = "qr-secret-123";
    const slot = currentSlot();
    const hash = slotHash(secret, slot);

    expect(validateSlotHash(secret, hash)).toBe(true);
  });

  it("rejects an expired hash outside the allowed slot window", () => {
    const secret = "qr-secret-123";
    const expiredSlot = currentSlot() - 120;
    const hash = slotHash(secret, expiredSlot);

    expect(validateSlotHash(secret, hash)).toBe(false);
  });

  it("parses org and workspace QR payloads correctly", () => {
    const orgPayload = Buffer.from(JSON.stringify({ o: "org_123", h: "abc123" })).toString("base64url");
    const workspacePayload = Buffer.from(JSON.stringify({ w: "workspace_456", h: "def456" })).toString("base64url");

    expect(parseQRData(orgPayload)).toEqual({ type: "org", org_id: "org_123", slot_hash: "abc123" });
    expect(parseQRData(workspacePayload)).toEqual({ type: "workspace", workspace_id: "workspace_456", slot_hash: "def456" });
  });

  it("returns null for malformed QR content", () => {
    expect(parseQRData("not-valid-base64!!!")).toBeNull();
    expect(parseQRData(Buffer.from("{}" ).toString("base64url"))).toBeNull();
  });
});
