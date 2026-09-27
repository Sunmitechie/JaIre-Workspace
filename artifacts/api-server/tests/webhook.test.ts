import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createHmac } from "crypto";
import type { AddressInfo } from "net";

process.env.PAYSTACK_SECRET_KEY = "paystack-test-secret";

const mockDb = {
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  payments: { reference: "reference", txSignature: "txSignature", status: "status", userWalletAddress: "userWalletAddress", amountUsdc: "amountUsdc", bookingId: "bookingId", userEmail: "userEmail" },
  users: { email: "email", walletAddress: "walletAddress" },
  bookings: { id: "id", escrowAmountUsdc: "escrowAmountUsdc", ngnAmountPaid: "ngnAmountPaid" },
  activityEvents: { id: "id" },
  workspaces: { id: "id", name: "name", hourlyRateNgn: "hourlyRateNgn", hourlyRateUsdc: "hourlyRateUsdc" },
}));

vi.mock("@workspace/db/schema", () => ({
  payments: { reference: "reference", txSignature: "txSignature", status: "status", userWalletAddress: "userWalletAddress", amountUsdc: "amountUsdc", bookingId: "bookingId", userEmail: "userEmail" },
  users: { email: "email", walletAddress: "walletAddress", verifierId: "verifierId" },
  bookings: { id: "id", escrowAmountUsdc: "escrowAmountUsdc", ngnAmountPaid: "ngnAmountPaid" },
  activityEvents: { id: "id" },
  workspaces: { id: "id", name: "name", hourlyRateNgn: "hourlyRateNgn", hourlyRateUsdc: "hourlyRateUsdc" },
}));

import paymentRouter from "../src/routes/payments";

describe("payments webhook", () => {
  let app: ReturnType<typeof express>;
  let server: ReturnType<typeof app.listen>;
  let baseUrl: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tx_signature: "topup_tx_123" }),
      text: async () => "",
    })) as any);

    app = express();
    app.use(express.raw({ type: "application/json" }));
    app.use("/api", paymentRouter);
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await new Promise<void>((resolve, reject) => {
      server.close((err?: Error) => (err ? reject(err) : resolve()));
    });
  });

  it("rejects a webhook when the Paystack HMAC is invalid", async () => {
    const payload = {
      event: "charge.success",
      data: { reference: "ref_bad", amount: 5000, currency: "NGN" },
    };

    const response = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": "bad-signature",
      },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid signature");
  });

  it("accepts a valid charge.success webhook and processes the payment", async () => {
    const payload = {
      event: "charge.success",
      data: {
        reference: "ref_ok_1",
        amount: 5000,
        currency: "NGN",
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHmac("sha512", "paystack-test-secret").update(rawBody).digest("hex");

    const paymentRow = {
      reference: "ref_ok_1",
      txSignature: null,
      status: "pending",
      userWalletAddress: "wallet_abc",
      amountUsdc: 1.5,
      bookingId: "booking_123",
      userEmail: "buyer@example.com",
    };
    const bookingRow = {
      id: "booking_123",
      escrowAmountUsdc: 1.5,
      ngnAmountPaid: 5000,
    };

    mockDb.select
      .mockReturnValueOnce({
        from: () => ({ where: () => [paymentRow] }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: () => [bookingRow] }),
      });

    mockDb.update.mockReturnValue({
      set: () => ({
        where: () => ({
          then: async () => undefined,
        }),
      }),
    });

    const response = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": signature,
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    expect(mockDb.update).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
  });
});
