import { beforeEach, vi } from "vitest";
import { createSolanaRpcMock } from "./mocks/solana";

process.env.WEB3AUTH_CLIENT_ID ??= "test-client-id";
process.env.WEB3AUTH_NODE_FACTOR_KEY ??= "test-node-factor-key";

export const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(createSolanaRpcMock());
});
