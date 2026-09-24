import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';

const verifyWeb3AuthJWT = vi.fn();
const deriveUserFactorShare = vi.fn();
const getUserWalletAddress = vi.fn();
const isRegisteredUser = vi.fn();
const getWalletBalance = vi.fn();

vi.mock('../src/services/mpc-service.js', () => ({
  verifyWeb3AuthJWT,
  deriveUserFactorShare,
  getUserWalletAddress,
  isRegisteredUser,
  deriveUserDevnetKeypair: vi.fn(),
}));

vi.mock('../src/services/solana-wallet.js', () => ({
  getWalletBalance,
  fundUserWallet: vi.fn(),
  vaultFundUser: vi.fn(),
  signUserUSDCTransfer: vi.fn(),
  vaultToUserTransfer: vi.fn(),
}));

vi.mock('../src/services/anchor-escrow.js', () => ({
  initializeEscrow: vi.fn(),
  settleSession: vi.fn(),
}));

import mpcRouter from '../src/routes/mpc';

describe('mpc routes', () => {
  let app: ReturnType<typeof express>;
  let server: any;
  let baseUrl: string;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/mpc', mpcRouter);
    server = app.listen(0);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('returns a factor share and wallet address for a valid JWT', async () => {
    verifyWeb3AuthJWT.mockResolvedValue({
      sub: 'google-user-1',
      email: 'user@example.com',
      name: 'Test User',
      verifier: 'google',
      verifierId: 'google-user-1',
    });
    isRegisteredUser.mockReturnValue(true);
    deriveUserFactorShare.mockReturnValue('factor-share-hex');
    getUserWalletAddress.mockReturnValue('wallet-address-123');

    const res = await fetch(`${baseUrl}/mpc/factor-share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: 'valid-jwt' }),
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.factor_share).toBe('factor-share-hex');
    expect(payload.wallet_address).toBe('wallet-address-123');
    expect(payload.verifier_id).toBe('google-user-1');
  });

  it('returns wallet balance for an authenticated user', async () => {
    verifyWeb3AuthJWT.mockResolvedValue({
      sub: 'google-user-2',
      email: 'balance@example.com',
      name: 'Balance User',
      verifier: 'google',
      verifierId: 'google-user-2',
    });
    getUserWalletAddress.mockReturnValue('wallet-address-456');
    getWalletBalance.mockResolvedValue({
      sol_balance: 1.25,
      usdc_balance: 42.5,
      usdc_mint: 'mint-abc',
      wallet_address: 'wallet-address-456',
    });

    const res = await fetch(`${baseUrl}/mpc/wallet-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: 'valid-jwt' }),
    });

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.sol_balance).toBe(1.25);
    expect(payload.usdc_balance).toBe(42.5);
    expect(payload.wallet_address).toBe('wallet-address-456');
    expect(payload.email).toBe('balance@example.com');
  });
});
