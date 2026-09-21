import { beforeEach, describe, expect, it, vi } from 'vitest';
import fetch from 'node-fetch';

vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

import { createPaymentIntent } from '../src/payments';

describe('createPaymentIntent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('posts the correct Stripe payload and returns the payment intent metadata', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ client_secret: 'sec_test_abc', id: 'pi_123' }),
    } as any);

    const result = await createPaymentIntent({
      amount_fiat: 42.5,
      currency: 'usd',
      email: 'buyer@example.com',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/payment_intents',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
        body: expect.stringContaining('amount=4250'),
      }),
    );

    expect(result).toEqual({
      client_secret: 'sec_test_abc',
      payment_intent_id: 'pi_123',
    });
  });

  it('uses USD as the default currency and surfaces a Stripe failure clearly', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ error: 'card_declined' }),
    } as any);

    await expect(
      createPaymentIntent({ amount_fiat: 15.75 }),
    ).rejects.toThrow('Stripe error: 402');
  });
});
