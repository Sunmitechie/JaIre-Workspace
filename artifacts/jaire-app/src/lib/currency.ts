export function formatNGN(amount: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatUSDC(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount).replace('$', 'USDC ');
}

export const EXCHANGE_RATE = 1600;

export function ngnToUsdc(ngn: number) {
  return ngn / EXCHANGE_RATE;
}

export function usdcToNgn(usdc: number) {
  return usdc * EXCHANGE_RATE;
}
