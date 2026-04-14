import asyncio
import logging
from typing import Optional

from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.message import Message
from solders.transaction import Transaction
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.rpc.types import TxOpts
from spl.token.instructions import (
    create_associated_token_account,
    get_associated_token_address,
    transfer as spl_transfer,
    TransferParams,
    mint_to as spl_mint_to,
    MintToParams,
)

from app.config import settings

logger = logging.getLogger(__name__)

USDC_MINT_DEVNET = Pubkey.from_string("7egxbd4d6tsPsRKJU8v74PKFnis4YKhbQgKX9HDCpR8S")
TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
SYSTEM_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")
SYSVAR_RENT_PUBKEY = Pubkey.from_string("SysvarRent111111111111111111111111111111111")
USDC_DECIMALS = 6
MEMO_PROGRAM_ID = Pubkey.from_string("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")


def get_ata_address(owner: Pubkey, mint: Pubkey) -> Pubkey:
    return get_associated_token_address(owner, mint)


def build_create_ata_instruction(payer: Pubkey, ata: Pubkey, owner: Pubkey, mint: Pubkey):
    return create_associated_token_account(payer, owner, mint)


def build_spl_transfer_instruction(source_ata: Pubkey, dest_ata: Pubkey, owner: Pubkey, amount: int):
    return spl_transfer(
        TransferParams(
            program_id=TOKEN_PROGRAM_ID,
            source=source_ata,
            dest=dest_ata,
            owner=owner,
            amount=amount,
            signers=[],
        )
    )


def build_mint_to_instruction(mint: Pubkey, dest: Pubkey, mint_authority: Pubkey, amount: int):
    return spl_mint_to(
        MintToParams(
            program_id=TOKEN_PROGRAM_ID,
            mint=mint,
            dest=dest,
            mint_authority=mint_authority,
            amount=amount,
            signers=[],
        )
    )


def _load_keypair(secret_str: str) -> Keypair:
    """
    Load a Solana Keypair from several common secret formats:
      - hex 32-byte seed (64 hex chars)   → Keypair.from_seed()
      - hex 64-byte keypair (128 hex chars) → Keypair.from_bytes()
      - base58-encoded 64-byte keypair     → Keypair.from_bytes()
      - JSON array of 64 integers          → Keypair.from_bytes()
    """
    s = secret_str.strip()

    # JSON array: [1, 2, 3, ...]
    if s.startswith("["):
        import json
        arr = json.loads(s)
        return Keypair.from_bytes(bytes(arr))

    # Hex string
    if all(c in "0123456789abcdefABCDEF" for c in s):
        raw = bytes.fromhex(s)
        if len(raw) == 32:
            return Keypair.from_seed(raw)
        elif len(raw) == 64:
            return Keypair.from_bytes(raw)
        else:
            raise ValueError(f"Unexpected hex key length: {len(raw)} bytes")

    # Base58
    import base58
    raw = base58.b58decode(s)
    if len(raw) == 64:
        return Keypair.from_bytes(raw)
    elif len(raw) == 32:
        return Keypair.from_seed(raw)
    raise ValueError(f"Cannot load keypair from secret (decoded {len(raw)} bytes)")


class SolanaService:
    """
    Manages the JaIre treasury keypair (used for devnet setup / minting)
    AND the JaIre vault keypair (used for all live USDC disbursements to users).

    Payment flow:
      User pays fiat (NGN/USD) via Paystack/Stripe
        → Oracle converts at live rate → X USDC
          → Vault signs SPL transfer → User's Solana wallet receives X USDC
    """

    def __init__(self):
        self.rpc_url = settings.solana_rpc_url
        self.client = AsyncClient(self.rpc_url, commitment=Confirmed)

        # Treasury — used for devnet setup, airdrops, minting test tokens
        treasury_secret = settings.jaire_treasury_private_key
        self.treasury_keypair = _load_keypair(treasury_secret)
        self.treasury_pubkey = self.treasury_keypair.pubkey()

        # Vault — the wallet that DISBURSES USDC to users after fiat payments
        vault_secret = settings.jaire_vault_private_key
        if vault_secret:
            self.vault_keypair = _load_keypair(vault_secret)
            self.vault_pubkey = self.vault_keypair.pubkey()
            # Sanity check: confirm the derived pubkey matches the configured vault address
            configured_addr = settings.jaire_vault_address
            if configured_addr and str(self.vault_pubkey) != configured_addr:
                logger.warning(
                    f"Vault pubkey mismatch! Derived: {self.vault_pubkey} | "
                    f"Config: {configured_addr} — using derived pubkey"
                )
        else:
            # Fallback: vault = treasury (devnet only)
            logger.warning("JAIRE_VAULT_PRIVATE_KEY not set — falling back to treasury for disbursements")
            self.vault_keypair = self.treasury_keypair
            self.vault_pubkey = self.treasury_pubkey

        logger.info(f"SolanaService ready.")
        logger.info(f"  Treasury : {self.treasury_pubkey}")
        logger.info(f"  Vault    : {self.vault_pubkey}")

    # ── Wallet Generation ──────────────────────────────────────────────────

    def generate_wallet(self) -> dict:
        keypair = Keypair()
        return {
            "pubkey": str(keypair.pubkey()),
            "secret_hex": keypair.secret().hex(),
        }

    # ── Balances ───────────────────────────────────────────────────────────

    async def get_sol_balance(self, pubkey_str: str) -> float:
        pubkey = Pubkey.from_string(pubkey_str)
        resp = await self.client.get_balance(pubkey, commitment=Confirmed)
        return resp.value / 1_000_000_000

    async def get_token_balance(self, pubkey_str: str, mint: Pubkey) -> float:
        try:
            owner = Pubkey.from_string(pubkey_str)
            ata = get_ata_address(owner, mint)
            if not await self.ata_exists(owner, mint):
                return 0.0
            resp = await self.client.get_token_account_balance(ata, commitment=Confirmed)
            if resp.value is None:
                return 0.0
            return float(resp.value.ui_amount or 0)
        except Exception:
            return 0.0

    async def get_usdc_balance(self, pubkey_str: str) -> float:
        return await self.get_token_balance(pubkey_str, USDC_MINT_DEVNET)

    async def ata_exists(self, owner: Pubkey, mint: Pubkey) -> bool:
        ata = get_ata_address(owner, mint)
        resp = await self.client.get_account_info(ata, commitment=Confirmed)
        return resp.value is not None

    # ── Vault Info ─────────────────────────────────────────────────────────

    async def get_vault_info(self, mint_override: Optional[str] = None) -> dict:
        pubkey_str = str(self.vault_pubkey)
        sol = await self.get_sol_balance(pubkey_str)
        mint = Pubkey.from_string(mint_override) if mint_override else USDC_MINT_DEVNET
        usdc = await self.get_token_balance(pubkey_str, mint)
        ata = get_ata_address(self.vault_pubkey, mint)
        return {
            "pubkey": pubkey_str,
            "sol_balance": sol,
            "usdc_balance": usdc,
            "usdc_ata": str(ata),
            "mint": str(mint),
            "network": settings.solana_network,
            "rpc": self.rpc_url,
        }

    async def get_treasury_info(self) -> dict:
        pubkey_str = str(self.treasury_pubkey)
        sol = await self.get_sol_balance(pubkey_str)
        usdc = await self.get_usdc_balance(pubkey_str)
        return {
            "pubkey": pubkey_str,
            "sol_balance": sol,
            "usdc_balance": usdc,
            "network": settings.solana_network,
            "rpc": self.rpc_url,
        }

    # ── Airdrop (devnet only) ──────────────────────────────────────────────

    async def request_airdrop(self, pubkey_str: str, sol_amount: float = 1.0) -> str:
        lamports = int(sol_amount * 1_000_000_000)
        pubkey = Pubkey.from_string(pubkey_str)
        resp = await self.client.request_airdrop(pubkey, lamports, commitment=Confirmed)
        if resp.value:
            await self._confirm_transaction(str(resp.value))
        return str(resp.value)

    # ── Core: Vault Disbursement ───────────────────────────────────────────

    async def disburse_from_vault(
        self,
        recipient_pubkey_str: str,
        amount_usdc: float,
        mint_pubkey_str: Optional[str] = None,
    ) -> str:
        """
        Transfer USDC from JaIre's vault to a user's Solana wallet.
        This is called after a successful fiat payment (Paystack/Stripe).
        The vault keypair signs the transaction.
        Creates the recipient's ATA if it doesn't exist (vault pays rent).
        """
        recipient = Pubkey.from_string(recipient_pubkey_str)
        vault = self.vault_pubkey
        mint = Pubkey.from_string(mint_pubkey_str) if mint_pubkey_str else USDC_MINT_DEVNET

        vault_ata = get_ata_address(vault, mint)
        recipient_ata = get_ata_address(recipient, mint)

        instructions = []

        # Create recipient ATA if needed — vault pays the rent
        if not await self.ata_exists(recipient, mint):
            instructions.append(create_associated_token_account(vault, recipient, mint))
            logger.info(f"Creating ATA for recipient {recipient_pubkey_str[:16]}…")

        raw_amount = int(amount_usdc * (10 ** USDC_DECIMALS))
        instructions.append(
            spl_transfer(
                TransferParams(
                    program_id=TOKEN_PROGRAM_ID,
                    source=vault_ata,
                    dest=recipient_ata,
                    owner=vault,
                    amount=raw_amount,
                    signers=[],
                )
            )
        )

        blockhash_resp = await self.client.get_latest_blockhash(commitment=Confirmed)
        recent_blockhash = blockhash_resp.value.blockhash
        msg = Message.new_with_blockhash(instructions, vault, recent_blockhash)
        tx = Transaction([self.vault_keypair], msg, recent_blockhash)

        resp = await self.client.send_transaction(
            tx, opts=TxOpts(skip_preflight=False, preflight_commitment=Confirmed)
        )
        signature = str(resp.value)
        logger.info(
            f"[VAULT] Disbursed {amount_usdc} USDC to {recipient_pubkey_str[:16]}… "
            f"| tx: {signature[:20]}…"
        )

        # Fire-and-forget confirmation in background
        asyncio.create_task(self._confirm_transaction(signature))
        return signature

    # ── Memo Transactions ─────────────────────────────────────────────────

    async def send_memo_from_vault(self, memo_text: str, wait_for_confirm: bool = False) -> str:
        """
        Write an on-chain memo signed by the JaIre vault.
        Used to anchor escrow events, Kamino deposits, and settlement records
        immutably on the Solana blockchain.

        The Memo Program stores the UTF-8 text on-chain — visible in any
        Solana explorer by looking at the transaction's instruction data.
        """
        from solders.instruction import Instruction

        memo_ix = Instruction(
            MEMO_PROGRAM_ID,
            memo_text.encode("utf-8"),
            [],
        )

        blockhash_resp = await self.client.get_latest_blockhash(commitment=Confirmed)
        recent_blockhash = blockhash_resp.value.blockhash
        msg = Message.new_with_blockhash([memo_ix], self.vault_pubkey, recent_blockhash)
        tx = Transaction([self.vault_keypair], msg, recent_blockhash)

        resp = await self.client.send_transaction(
            tx, opts=TxOpts(skip_preflight=False, preflight_commitment=Confirmed)
        )
        signature = str(resp.value)
        logger.info(f"[VAULT MEMO] {memo_text[:60]}… | tx: {signature[:20]}…")

        if wait_for_confirm:
            await self._confirm_transaction(signature)
        else:
            asyncio.create_task(self._confirm_transaction(signature))

        return signature

    # ── Legacy: Treasury Transfer (kept for devnet setup only) ────────────

    async def transfer_usdc(
        self,
        recipient_pubkey_str: str,
        amount_usdc: float,
        mint_pubkey_str: Optional[str] = None,
    ) -> str:
        """Treasury-signed transfer. Use only for devnet setup / minting."""
        recipient = Pubkey.from_string(recipient_pubkey_str)
        treasury = self.treasury_keypair.pubkey()
        mint = Pubkey.from_string(mint_pubkey_str) if mint_pubkey_str else USDC_MINT_DEVNET
        treasury_ata = get_ata_address(treasury, mint)
        recipient_ata = get_ata_address(recipient, mint)

        instructions = []
        if not await self.ata_exists(recipient, mint):
            instructions.append(create_associated_token_account(treasury, recipient, mint))

        raw_amount = int(amount_usdc * (10 ** USDC_DECIMALS))
        instructions.append(
            spl_transfer(
                TransferParams(
                    program_id=TOKEN_PROGRAM_ID,
                    source=treasury_ata,
                    dest=recipient_ata,
                    owner=treasury,
                    amount=raw_amount,
                    signers=[],
                )
            )
        )

        blockhash_resp = await self.client.get_latest_blockhash(commitment=Confirmed)
        recent_blockhash = blockhash_resp.value.blockhash
        msg = Message.new_with_blockhash(instructions, treasury, recent_blockhash)
        tx = Transaction([self.treasury_keypair], msg, recent_blockhash)

        resp = await self.client.send_transaction(
            tx, opts=TxOpts(skip_preflight=False, preflight_commitment=Confirmed)
        )
        signature = str(resp.value)
        logger.info(f"[TREASURY] USDC transfer: {signature}")
        await self._confirm_transaction(signature)
        return signature

    # Alias for backward compatibility
    async def submit_transaction_and_return(
        self,
        recipient_pubkey_str: str,
        amount_usdc: float,
        mint_pubkey_str: Optional[str] = None,
    ) -> str:
        return await self.disburse_from_vault(recipient_pubkey_str, amount_usdc, mint_pubkey_str)

    # ── Transaction Confirmation ───────────────────────────────────────────

    async def _confirm_transaction(self, signature: str, max_attempts: int = 60, poll_interval: float = 2.0):
        from solders.signature import Signature
        sig = Signature.from_string(signature)
        for attempt in range(max_attempts):
            resp = await self.client.get_signature_statuses([sig])
            if resp.value and resp.value[0] is not None:
                status = resp.value[0]
                if status.err:
                    raise RuntimeError(f"Transaction failed: {status.err}")
                cs = str(status.confirmation_status).lower()
                if "confirmed" in cs or "finalized" in cs:
                    logger.info(f"Tx {signature[:20]}… confirmed after {attempt * poll_interval:.0f}s")
                    return
            await asyncio.sleep(poll_interval)
        raise TimeoutError(f"Transaction {signature} not confirmed after {max_attempts * poll_interval:.0f}s")

    async def close(self):
        await self.client.close()


_solana_service: Optional[SolanaService] = None


def get_solana_service() -> SolanaService:
    global _solana_service
    if _solana_service is None:
        _solana_service = SolanaService()
    return _solana_service
