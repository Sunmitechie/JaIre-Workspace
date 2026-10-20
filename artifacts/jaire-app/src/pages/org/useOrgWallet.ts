import { useCallback, useState } from "react";
import { getOrgToken } from "@/lib/org-auth";

const API = `${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/api`;

export function useOrgWallet() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletCopied, setWalletCopied] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const loadUsdcBalance = useCallback(async (address: string) => {
    setBalanceLoading(true);
    try {
      const response = await fetch(`${API}/wallet/balance?address=${address}`);
      if (response.ok) {
        const data = await response.json();
        setUsdcBalance(data.balance_usdc ?? data.usdc_balance ?? 0);
      }
    } catch {
      // Keep the previous balance when the request cannot reach the API.
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const loadWalletBalance = useCallback(async () => {
    try {
      const token = getOrgToken();
      const response = await fetch(`${API}/org/wallet-balance`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.walletAddress) {
        setWalletAddress(data.walletAddress);
        await loadUsdcBalance(data.walletAddress);
      }
    } catch {
      // Wallet details are optional until the organization links one.
    }
  }, [loadUsdcBalance]);

  const copyWallet = useCallback(async () => {
    if (!walletAddress) return;
    await navigator.clipboard.writeText(walletAddress);
    setWalletCopied(true);
    window.setTimeout(() => setWalletCopied(false), 2000);
  }, [walletAddress]);

  return {
    walletAddress,
    setWalletAddress,
    walletCopied,
    usdcBalance,
    balanceLoading,
    loadWalletBalance,
    loadUsdcBalance,
    copyWallet,
  };
}