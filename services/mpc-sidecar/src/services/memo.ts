import { PublicKey, TransactionInstruction } from "@solana/web3.js";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/**
 * Build an SPL Memo instruction that attaches a UTF-8 string to a transaction.
 * Visible on Solana Explorer and useful for on-chain bookkeeping.
 */
export function buildMemoInstruction(memo: string): TransactionInstruction {
  return new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo.slice(0, 566), "utf-8"),
  });
}
