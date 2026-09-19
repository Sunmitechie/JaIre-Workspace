import { describe, it, expect, vi, beforeEach } from 'vitest';
import fetch from 'node-fetch';

vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

// Simple payment helper that would exist in the api-server for this test
import { createPaymentIntent } from '../src/payments';

describe('payments', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates stripe payment intent and returns client secret', async () => {
    // Mock the external Stripe API (via node-fetch)
    const fakeResponse = {
      client_secret: 'sec_test_abc',
      id: 'pi_123',
    };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => fakeResponse,
      ok: true,
      status: 200,
    });

    const result = await createPaymentIntent({ amount_fiat: 100.0, currency: 'usd', email: 'a@b.com' });

    expect(result.payment_intent_id).toBe('pi_123');
    expect(result.client_secret).toBe('sec_test_abc');
  });
});
