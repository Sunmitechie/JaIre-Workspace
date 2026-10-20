import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOrgWallet } from "../src/pages/org/useOrgWallet";

vi.mock("@/lib/org-auth", () => ({ getOrgToken: () => "org-token" }));

describe("useOrgWallet", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the organization wallet and then its USDC balance", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ walletAddress: "wallet-123" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ balance_usdc: 18.5 }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOrgWallet());
    await act(async () => result.current.loadWalletBalance());

    expect(result.current.walletAddress).toBe("wallet-123");
    expect(result.current.usdcBalance).toBe(18.5);
    expect(result.current.balanceLoading).toBe(false);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/org/wallet-balance", {
      headers: { Authorization: "Bearer org-token" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/wallet/balance?address=wallet-123");
  });
});