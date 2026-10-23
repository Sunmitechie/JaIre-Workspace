import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fetch from "node-fetch";
import type { AddressInfo } from "net";
import {
  createPaystackMockFetch,
  paystackMockInitializeResponse,
  paystackMockVerifyResponse,
} from "./mocks/paystack";

process.env.PAYSTACK_SECRET_KEY = "paystack-test-secret";

const mockInsertValues = vi.fn();
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(() => ({ values: mockInsertValues })),
  update: vi.fn(),
};

vi.mock("@workspace/db", () => ({ db: mockDb }));
vi.mock("@workspace/db/schema", () => ({
  payments: { reference: "reference" },
  users: { email: "email" },
  bookings: {},
  activityEvents: {},
  workspaces: {},
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));

import paymentRouter from "../src/routes/payments";

describe("payment routes", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let baseUrl: string;

  beforeEach(() => {
    mockDb.select.mockReset();
    mockDb.insert.mockClear();
    mockInsertValues.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", createPaystackMockFetch());

    const app = express();
    app.use(express.json());
    app.use("/api", paymentRouter);
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => (error ? reject(error) : resolve()));
    });
  });

  it("initiates a payment and records a pending transaction", async () => {
    const response = await fetch(`${baseUrl}/api/payments/initiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount_ngn: 5000,
        user_email: "buyer@example.com",
        booking_id: "booking-1",
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      payment_url: "https://paystack.com/pay/mock-checkout",
      amount_ngn: 5000,
      fx_rate: 1600,
      access_code: "mock_access_code_123",
    });
    expect(payload.reference).toEqual(expect.any(String));
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: "booking-1",
      userEmail: "buyer@example.com",
      amountNgn: 5000,
      reference: payload.reference,
      provider: "paystack",
      status: "pending",
    }));
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.paystack.co/transaction/initialize",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"amount":500000'),
      }),
    );
  });

  it("returns a gateway error when Paystack rejects payment initiation", async () => {
    vi.stubGlobal("fetch", createPaystackMockFetch({
      initialize: {
        ok: false,
        status: 400,
        body: { ...paystackMockInitializeResponse, status: false, message: "Invalid amount" },
      },
    }));

    const response = await fetch(`${baseUrl}/api/payments/initiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount_ngn: 5000, user_email: "buyer@example.com" }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Invalid amount" });
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("verifies a successful Paystack payment", async () => {
    mockDb.select.mockReturnValue({ from: () => ({ where: async () => [] }) });

    const response = await fetch(`${baseUrl}/api/payments/verify/JI-TEST-0001`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reference: "JI-TEST-0001",
      status: "success",
      amount_ngn: 5000,
      paid: true,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.paystack.co/transaction/verify/JI-TEST-0001",
      expect.any(Object),
    );
  });

  it("returns a gateway error when Paystack cannot verify a payment", async () => {
    vi.stubGlobal("fetch", createPaystackMockFetch({
      verify: {
        ok: false,
        status: 502,
        body: { ...paystackMockVerifyResponse, status: false, message: "Verification unavailable" },
      },
    }));

    const response = await fetch(`${baseUrl}/api/payments/verify/JI-TEST-0001`);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Verification unavailable" });
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
