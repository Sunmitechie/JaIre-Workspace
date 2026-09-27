import crypto from "crypto";

export const JAIRE_RATE = 1608;

export function ngnToUsdc(ngn: number, rate: number = JAIRE_RATE): number {
  if (!Number.isFinite(ngn) || ngn <= 0) {
    return 0;
  }

  return parseFloat((ngn / rate).toFixed(6));
}

export function generateRef(): string {
  return `JI-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}
