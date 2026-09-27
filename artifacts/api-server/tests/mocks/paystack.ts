export type PaystackMockResponse = {
  status: boolean;
  message: string;
  data: Record<string, unknown>;
};

export const paystackMockInitializeResponse: PaystackMockResponse = {
  status: true,
  message: "Authorization URL created",
  data: {
    authorization_url: "https://paystack.com/pay/mock-checkout",
    access_code: "mock_access_code_123",
    reference: "JI-TEST-0001",
  },
};

export const paystackMockVerifyResponse: PaystackMockResponse = {
  status: true,
  message: "Verification successful",
  data: {
    reference: "JI-TEST-0001",
    amount: 500000,
    currency: "NGN",
    status: "success",
    paid_at: "2026-09-27T12:00:00.000Z",
    customer: {
      email: "buyer@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
    },
  },
};

export const paystackMockWebhookEvent = {
  event: "charge.success",
  data: {
    id: 12345,
    reference: "JI-TEST-0001",
    amount: 500000,
    currency: "NGN",
    status: "success",
    customer: { email: "buyer@example.com" },
  },
};

export function createPaystackMockFetch() {
  return async (_input: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => {
      const url = String(_input);
      if (url.includes("transaction/initialize")) {
        return paystackMockInitializeResponse;
      }
      if (url.includes("transaction/verify/")) {
        return paystackMockVerifyResponse;
      }
      return paystackMockVerifyResponse;
    },
    text: async () => "",
  });
}
