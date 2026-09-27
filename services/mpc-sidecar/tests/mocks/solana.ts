export type SolanaBalanceResult = {
  context: { slot: number };
  value: {
    lamports: number;
    data: [string, string];
    owner: string;
    executable: boolean;
    rent_epoch: number;
  };
};

export const mockSolanaBalance: SolanaBalanceResult = {
  context: { slot: 42 },
  value: {
    lamports: 1_500_000_000,
    data: ["", "base64"],
    owner: "11111111111111111111111111111111",
    executable: false,
    rent_epoch: 0,
  },
};

export const mockTokenBalance = {
  value: {
    amount: "250000000",
    decimals: 6,
    uiAmount: 250,
    uiAmountString: "250",
  },
  context: { slot: 42 },
};

export const mockSolanaSignature = {
  blockhash: "mock-blockhash-11111111111111111111111111111111",
  lastValidBlockHeight: 1_000,
};

export function createSolanaRpcMock() {
  return async (_url: string, _payload?: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({
      jsonrpc: "2.0",
      id: 1,
      result: {
        context: { slot: 42 },
        value: {
          lamports: 1_500_000_000,
          data: ["", "base64"],
          owner: "11111111111111111111111111111111",
          executable: false,
          rent_epoch: 0,
        },
      },
    }),
    text: async () => "",
  });
}

export function createSolanaTokenBalanceMock() {
  return async (_url: string, _payload?: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({
      jsonrpc: "2.0",
      id: 1,
      result: {
        value: {
          amount: "250000000",
          decimals: 6,
          uiAmount: 250,
          uiAmountString: "250",
        },
        context: { slot: 42 },
      },
    }),
    text: async () => "",
  });
}
