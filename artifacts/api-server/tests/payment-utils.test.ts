import { describe, expect, it } from "vitest";
import { generateRef, ngnToUsdc } from "../src/lib/payment-utils";

describe("payment utilities", () => {
  it("converts NGN to USDC at the JaIre rate", () => {
    expect(ngnToUsdc(1608)).toBe(1);
    expect(ngnToUsdc(3216)).toBe(2);
  });

  it("returns zero for zero or negative amounts", () => {
    expect(ngnToUsdc(0)).toBe(0);
    expect(ngnToUsdc(-100)).toBe(0);
  });

  it("generates a deterministic reference shape with JaIre prefix", () => {
    const ref = generateRef();

    expect(ref.startsWith("JI-")).toBe(true);
    expect(ref).toMatch(/^JI-[A-Z0-9-]+$/);
    expect(ref.length).toBeGreaterThan(10);
  });
});
