import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import { createHmac } from "crypto";
import type { AddressInfo } from "net";

process.env.JWT_SECRET = "test-secret";

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  organizations: { id: "id", ownerEmail: "ownerEmail", qrSecret: "qrSecret", ownerWalletAddress: "ownerWalletAddress", businessName: "businessName" },
  workspaces: { id: "id", orgId: "orgId", name: "name", qrSecret: "qrSecret", hourlyRateNgn: "hourlyRateNgn", hourlyRateUsdc: "hourlyRateUsdc", isAvailable: "isAvailable" },
  bookings: { id: "id", userId: "userId", status: "status", checkInTime: "checkInTime", workspaceId: "workspaceId", plannedDurationHours: "plannedDurationHours", escrowAmountUsdc: "escrowAmountUsdc", userName: "userName" },
  activityEvents: { id: "id" },
  users: { email: "email", walletAddress: "walletAddress", name: "name", updatedAt: "updatedAt" },
  devices: { orgId: "orgId", workspaceId: "workspaceId", mqttClientId: "mqttClientId" },
}));

vi.mock("../src/services/mqtt", () => ({
  publishCommand: vi.fn(() => true),
  isConnected: vi.fn(() => true),
}));

import qrRouter from "../src/routes/qr";

function createQuery(rows: any[]) {
  const query: any[] = [...rows];
  query.where = () => query;
  query.limit = async (n: number) => rows.slice(0, n);
  return query;
}

function makeOrgToken(email: string, secret: string) {
  return jwt.sign({ email }, secret, { expiresIn: "1h" });
}

function slotHash(secret: string, slot: number): string {
  return createHmac("sha256", secret).update(slot.toString()).digest("hex").slice(0, 16);
}

function makeOrgQr(orgId: string, secret: string): string {
  const slot = Math.floor(Date.now() / 10_000);
  return Buffer.from(JSON.stringify({ o: orgId, h: slotHash(secret, slot) })).toString("base64url");
}

describe("qr routes", () => {
  let app: ReturnType<typeof express>;
  let server: ReturnType<typeof app.listen>;
  let baseUrl: string;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use("/qr", qrRouter);

    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err?: Error) => (err ? reject(err) : resolve()));
    });
  });

  it("GET /qr/org returns 200 with signed org QR data", async () => {
    const org = { id: "org-1", ownerEmail: "owner@example.com", qrSecret: null, businessName: "Acme HQ" };

    mockDb.select.mockImplementationOnce(() => createQuery([org]));
    mockDb.update.mockImplementationOnce(() => ({
      set: () => ({
        where: () => ({
          returning: async () => [{ ...org, qrSecret: "generated-secret" }],
        }),
      }),
    }));

    const response = await fetch(`${baseUrl}/qr/org`, {
      headers: { Authorization: `Bearer ${makeOrgToken("owner@example.com", "test-secret")}` },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.org_id).toBe("org-1");
    expect(payload.qr_data).toBeTruthy();
    expect(payload.expires_in_ms).toBeGreaterThan(0);
  });

  it("GET /qr/org returns 401 without a valid org auth token", async () => {
    const response = await fetch(`${baseUrl}/qr/org`);

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Missing auth token");
  });

  it("POST /qr/checkin returns 401 for an expired QR hash", async () => {
    const org = { id: "org-1", ownerEmail: "owner@example.com", qrSecret: "org-secret", businessName: "Acme HQ" };
    mockDb.select.mockImplementationOnce(() => createQuery([org]));

    const expiredQr = Buffer.from(JSON.stringify({ o: org.id, h: "deadbeef" })).toString("base64url");

    const response = await fetch(`${baseUrl}/qr/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qr_data: expiredQr,
        user_id: "user-1",
        user_email: "user@example.com",
      }),
    });

    expect(response.status).toBe(401);
    expect((await response.json()).error).toContain("expired");
  });

  it("POST /qr/checkin returns 409 when the user already has an active booking", async () => {
    const org = { id: "org-1", ownerEmail: "owner@example.com", qrSecret: "org-secret", businessName: "Acme HQ" };
    const workspace = { id: "ws-1", orgId: "org-1", name: "Desk 1", qrSecret: "org-secret", hourlyRateNgn: 1500, hourlyRateUsdc: 12, isAvailable: true };
    const existingBooking = {
      id: "booking-1",
      userId: "user-1",
      status: "active",
      workspaceId: "ws-1",
      checkInTime: new Date().toISOString(),
    };

    mockDb.select
      .mockImplementationOnce(() => createQuery([org]))
      .mockImplementationOnce(() => createQuery([workspace]))
      .mockImplementationOnce(() => createQuery([existingBooking]));

    const response = await fetch(`${baseUrl}/qr/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qr_data: makeOrgQr(org.id, org.qrSecret),
        user_id: "user-1",
        user_email: "user@example.com",
      }),
    });

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error).toContain("already checked in");
    expect(payload.booking_id).toBe("booking-1");
  });
});
