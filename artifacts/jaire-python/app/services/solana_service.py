import asyncio
import logging
from typing import Optional

from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.message import Message
from solders.transaction import Transaction
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed, Finalized
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

USDC_MINT_DEVNET = Pubkey.from_string("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")
TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
SYSTEM_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")
SYSVAR_RENT_PUBKEY = Pubkey.from_string("SysvarRent111111111111111111111111111111111")
USDC_DECIMALS = 6


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


class SolanaService:
    def __init__(self):
        self.rpc_url = settings.solana_rpc_url
        self.client = AsyncClient(self.rpc_url, commitment=Confirmed)

        secret_bytes = bytes.fromhex(settings.jaire_treasury_private_key)
        self.treasury_keypair = Keypair.from_seed(secret_bytes)
        self.treasury_pubkey = self.treasury_keypair.pubkey()

        logger.info(f"SolanaService ready. Treasury: {self.treasury_pubkey}")

    def generate_wallet(self) -> dict:
        keypair = Keypair()
        return {
            "pubkey": str(keypair.pubkey()),
            "secret_hex": keypair.secret().hex(),
        }

    async def request_airdrop(self, pubkey_str: str, sol_amount: float = 1.0) -> str:
        lamports = int(sol_amount * 1_000_000_000)
        pubkey = Pubkey.from_string(pubkey_str)
        resp = await self.client.request_airdrop(pubkey, lamports, commitment=Confirmed)
        if resp.value:
            await self._confirm_transaction(str(resp.value))
        return str(resp.value)

    async def get_sol_balance(self, pubkey_str: str) -> float:
        pubkey = Pubkey.from_string(pubkey_str)
        resp = await self.client.get_balance(pubkey, commitment=Confirmed)
        return resp.value / 1_000_000_000

    async def get_usdc_balance(self, pubkey_str: str) -> float:
        try:
            owner = Pubkey.from_string(pubkey_str)
            ata = get_ata_address(owner, USDC_MINT_DEVNET)
            ata_exists = await self.ata_exists(owner, USDC_MINT_DEVNET)
            if not ata_exists:
                return 0.0
            resp = await self.client.get_token_account_balance(ata, commitment=Confirmed)
            if resp.value is None:
                return 0.0
            return float(resp.value.ui_amount or 0)
        except Exception:
            return 0.0

    async def ata_exists(self, owner: Pubkey, mint: Pubkey) -> bool:
        ata = get_ata_address(owner, mint)
        resp = await self.client.get_account_info(ata, commitment=Confirmed)
        return resp.value is not None

    async def transfer_usdc(
        self,
        recipient_pubkey_str: str,
        amount_usdc: float,
        mint_pubkey_str: Optional[str] = None,
    ) -> str:
        recipient = Pubkey.from_string(recipient_pubkey_str)
        treasury = self.treasury_keypair.pubkey()

        # Use supplied mint or fall back to devnet USDC
        if mint_pubkey_str:
            mint = Pubkey.from_string(mint_pubkey_str)
            logger.info(f"Using custom mint: {mint_pubkey_str}")
        else:
            mint = USDC_MINT_DEVNET

        treasury_ata = get_ata_address(treasury, mint)
        recipient_ata = get_ata_address(recipient, mint)

        instructions = []

        recipient_ata_exists = await self.ata_exists(recipient, mint)
        if not recipient_ata_exists:
            create_ata_ix = build_create_ata_instruction(
                payer=treasury,
                ata=recipient_ata,
                owner=recipient,
                mint=mint,
            )
            instructions.append(create_ata_ix)
            logger.info(f"Will create ATA for recipient: {recipient_ata}")

        raw_amount = int(amount_usdc * (10 ** USDC_DECIMALS))
        transfer_ix = build_spl_transfer_instruction(
            source_ata=treasury_ata,
            dest_ata=recipient_ata,
            owner=treasury,
            amount=raw_amount,
        )
        instructions.append(transfer_ix)

        blockhash_resp = await self.client.get_latest_blockhash(commitment=Confirmed)
        recent_blockhash = blockhash_resp.value.blockhash

        msg = Message.new_with_blockhash(instructions, treasury, recent_blockhash)
        tx = Transaction([self.treasury_keypair], msg, recent_blockhash)

        resp = await self.client.send_transaction(
            tx,
            opts=TxOpts(skip_preflight=False, preflight_commitment=Confirmed),
        )
        signature = str(resp.value)
        logger.info(f"USDC transfer tx: {signature}")

        await self._confirm_transaction(signature)
        return signature

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

    async def _confirm_transaction(self, signature: str, max_attempts: int = 60, poll_interval: float = 2.0):
        from solders.signature import Signature
        sig = Signature.from_string(signature)
        for attempt in range(max_attempts):
            resp = await self.client.get_signature_statuses([sig])
            if resp.value and resp.value[0] is not None:
                status = resp.value[0]
                if status.err:
                    raise RuntimeError(f"Transaction failed: {status.err}")
                # confirmation_status may be an enum; compare via str()
                cs = str(status.confirmation_status).lower()
                if "confirmed" in cs or "finalized" in cs:
                    logger.info(f"Transaction {signature[:20]}... confirmed after {attempt * poll_interval:.0f}s")
                    return
            await asyncio.sleep(poll_interval)
        raise TimeoutError(f"Transaction {signature} not confirmed after {max_attempts * poll_interval:.0f}s")

    async def submit_transaction_and_return(
        self,
        recipient_pubkey_str: str,
        amount_usdc: float,
        mint_pubkey_str: Optional[str] = None,
    ) -> str:
        """
        Submit a USDC transfer transaction and return the signature immediately.
        Confirmation happens asynchronously in the background.
        """
        recipient = Pubkey.from_string(recipient_pubkey_str)
        treasury = self.treasury_keypair.pubkey()

        mint = Pubkey.from_string(mint_pubkey_str) if mint_pubkey_str else USDC_MINT_DEVNET
        treasury_ata = get_ata_address(treasury, mint)
        recipient_ata = get_ata_address(recipient, mint)

        instructions = []
        recipient_ata_exists = await self.ata_exists(recipient, mint)
        if not recipient_ata_exists:
            instructions.append(create_associated_token_account(treasury, recipient, mint))
            logger.info(f"Will create ATA for recipient: {recipient_ata}")

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
        logger.info(f"USDC transfer submitted: {signature}")

        # Fire-and-forget confirmation in background
        asyncio.create_task(self._confirm_transaction(signature))
        return signature

    async def close(self):
        await self.client.close()


_solana_service: Optional[SolanaService] = None


def get_solana_service() -> SolanaService:
    global _solana_service
    if _solana_service is None:
        _solana_service = SolanaService()
    return _solana_service
