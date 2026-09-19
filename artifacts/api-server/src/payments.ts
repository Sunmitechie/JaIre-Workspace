import fetch from 'node-fetch';

export async function createPaymentIntent(opts: { amount_fiat: number; currency?: string; email?: string }) {
  const amount_cents = Math.round(opts.amount_fiat * 100);
  // This simulates a call to an external Stripe service via fetch
  const r = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `amount=${amount_cents}&currency=${opts.currency || 'usd'}`,
  });
  if (!r.ok) throw new Error(`Stripe error: ${r.status}`);
  const data = await r.json();
  return { client_secret: data.client_secret, payment_intent_id: data.id };
}
