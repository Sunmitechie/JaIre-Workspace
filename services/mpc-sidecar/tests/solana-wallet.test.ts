import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";

const { rpc, sendAndConfirmTransaction, splMocks } = vi.hoisted(() => ({
  rpc: {
    getBalance: vi.fn(),
    getTokenAccountBalance: vi.fn(),
  },
  sendAndConfirmTransaction: vi.fn(),
  splMocks: {
    getMint: vi.fn(),
    getOrCreateAssociatedTokenAccount: vi.fn(),
    createMintToInstruction: vi.fn(),
    createTransferInstruction: vi.fn(),
  },
}));

vi.mock("@solana/web3.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/web3.js")>();
  return {
    ...actual,
    Connection: vi.fn(() => rpc),
    sendAndConfirmTransaction,
  };
});

vi.mock("@solana/spl-token", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/spl-token")>();
  return {
    ...actual,
    getMint: splMocks.getMint,
    getOrCreateAssociatedTokenAccount: splMocks.getOrCreateAssociatedTokenAccount,
    createMintToInstruction: splMocks.createMintToInstruction,
    createTransferInstruction: splMocks.createTransferInstruction,
  };
});

import {
  fundUserWallet,
  getTreasuryKeypair,
  getVaultKeypair,
  getWalletBalance,
  vaultFundUser,
} from "../src/services/solana-wallet.js";

const mint = new PublicKey("7egxbd4d6tsPsRKJU8v74PKFnis4YKhbQgKX9HDCpR8S");
const user = new PublicKey("11111111111111111111111111111111");
const treasury = Keypair.fromSeed(new Uint8Array(32).fill(7));
const vault = Keypair.fromSeed(new Uint8Array(32).fill(9));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JAIRE_TREASURY_PRIVATE_KEY = JSON.stringify(Array.from(treasury.secretKey));
  process.env.JAIRE_VAULT_PRIVATE_KEY = JSON.stringify(Array.from(vault.secretKey));
  rpc.getBalance.mockResolvedValue(1_000_000_000);
  rpc.getTokenAccountBalance.mockResolvedValue({ value: { uiAmount: 23.75 } });
  splMocks.getMint.mockResolvedValue({ decimals: 6 });
  splMocks.getOrCreateAssociatedTokenAccount.mockResolvedValue({
    address: new PublicKey("ComputeBudget111111111111111111111111111111"),
    amount: 1_000_000n,
  });
  splMocks.createMintToInstruction.mockReturnValue({ keys: [], programId: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) });
  splMocks.createTransferInstruction.mockReturnValue({ keys: [], programId: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0) });
  sendAndConfirmTransaction.mockResolvedValue("mock-solana-signature");
});

describe("Solana wallet operations", () => {
  it("returns SOL and token balances for a wallet", async () => {
    const result = await getWalletBalance(user.toBase58(), mint.toBase58());

    expect(rpc.getBalance).toHaveBeenCalledOnce();
    expect(rpc.getTokenAccountBalance).toHaveBeenCalledOnce();
    expect(result).toEqual({
      sol_balance: 1,
      usdc_balance: 23.75,
      usdc_mint: mint.toBase58(),
      wallet_address: user.toBase58(),
    });
  });

  it("treats a missing associated token account as a zero token balance", async () => {
    rpc.getTokenAccountBalance.mockRejectedValue(new Error("account not found"));

    const result = await getWalletBalance(user.toBase58(), mint.toBase58());

    expect(result.usdc_balance).toBe(0);
    expect(result.sol_balance).toBe(1);
  });

  it("returns a deterministic result without RPC calls in simulated funding", async () => {
    const result = await fundUserWallet(user.toBase58(), 4.25, mint.toBase58(), true);

    expect(result).toEqual({
      success: true,
      tx_signature: `SIMULATED-FUND-${user.toBase58().slice(0, 8).toUpperCase()}`,
      amount_usdc: 4.25,
      wallet_address: user.toBase58(),
      is_simulated: true,
    });
    expect(rpc.getBalance).not.toHaveBeenCalled();
    expect(sendAndConfirmTransaction).not.toHaveBeenCalled();
  });

  it("activates an empty wallet and mints the requested USDC amount", async () => {
    rpc.getBalance.mockResolvedValue(0);
    sendAndConfirmTransaction
      .mockResolvedValueOnce("activation-signature")
      .mockResolvedValueOnce("fund-signature");

    const result = await fundUserWallet(user.toBase58(), 12.345678, mint.toBase58());

    expect(result).toMatchObject({ success: true, tx_signature: "fund-signature", is_simulated: false });
    expect(splMocks.createMintToInstruction).toHaveBeenCalledWith(
      mint,
      expect.any(PublicKey),
      getTreasuryKeypair().publicKey,
      12_345_678,
    );
    expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(2);
  });

  it("returns the RPC error when direct funding fails", async () => {
    sendAndConfirmTransaction.mockRejectedValue(new Error("RPC unavailable"));

    const result = await fundUserWallet(user.toBase58(), 2, mint.toBase58());

    expect(result).toMatchObject({ success: false, tx_signature: null, error: "RPC unavailable" });
  });

  it("tops up a low-balance vault and transfers the requested amount", async () => {
    sendAndConfirmTransaction
      .mockResolvedValueOnce("vault-topup-signature")
      .mockResolvedValueOnce("vault-transfer-signature");

    const result = await vaultFundUser(user.toBase58(), 8.5, mint.toBase58());

    expect(result).toMatchObject({ success: true, tx_signature: "vault-transfer-signature", amount_usdc: 8.5 });
    expect(splMocks.createMintToInstruction).toHaveBeenCalledWith(
      mint,
      expect.any(PublicKey),
      getTreasuryKeypair().publicKey,
      10_000_000_000,
    );
    expect(splMocks.createTransferInstruction).toHaveBeenCalledWith(
      expect.any(PublicKey),
      expect.any(PublicKey),
      getVaultKeypair().publicKey,
      8_500_000,
      [],
      expect.any(PublicKey),
    );
    expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(2);
  });

  it("returns the RPC error when vault funding fails", async () => {
    splMocks.getMint.mockRejectedValue(new Error("mint account unavailable"));

    const result = await vaultFundUser(user.toBase58(), 8, mint.toBase58());

    expect(result).toMatchObject({ success: false, tx_signature: null, error: "mint account unavailable" });
    expect(sendAndConfirmTransaction).not.toHaveBeenCalled();
  });
});