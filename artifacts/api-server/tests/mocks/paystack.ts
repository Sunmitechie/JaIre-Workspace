export type PaystackMockResponse = {
  status: boolean;
  message: string;
  data: Record<string, unknown>;
};

type PaystackMockHttpResponse = {
  ok: boolean;
  status: number;
  body: PaystackMockResponse;
};

type PaystackMockFetchOptions = {
  initialize?: Partial<PaystackMockHttpResponse>;
  verify?: Partial<PaystackMockHttpResponse>;
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

export function createPaystackMockFetch(options: PaystackMockFetchOptions = {}) {
  return async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const response = String(_input).includes("transaction/initialize")
      ? { ok: true, status: 200, body: paystackMockInitializeResponse, ...options.initialize }
      : { ok: true, status: 200, body: paystackMockVerifyResponse, ...options.verify };

    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
      text: async () => "",
    };
  };
}
