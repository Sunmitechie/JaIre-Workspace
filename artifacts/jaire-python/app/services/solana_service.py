import asyncio
import logging
from typing import Optional

from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.instruction import Instruction, AccountMeta
from solders.message import Message
from solders.transaction import Transaction
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed, Finalized
from solana.rpc.types import TxOpts

from app.config import settings

logger = logging.getLogger(__name__)

USDC_MINT_DEVNET = Pubkey.from_string("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")
TOKEN_PROGRAM_ID = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
ATA_PROGRAM_ID = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bXh")
SYSTEM_PROGRAM_ID = Pubkey.from_string("11111111111111111111111111111111")
SYSVAR_RENT_PUBKEY = Pubkey.from_string("SysvarRent111111111111111111111111111111111")
USDC_DECIMALS = 6


def get_ata_address(owner: Pubkey, mint: Pubkey) -> Pubkey:
    seeds = [bytes(owner), bytes(TOKEN_PROGRAM_ID), bytes(mint)]
    ata, _ = Pubkey.find_program_address(seeds, ATA_PROGRAM_ID)
    return ata


def build_create_ata_instruction(payer: Pubkey, ata: Pubkey, owner: Pubkey, mint: Pubkey) -> Instruction:
    return Instruction(
        accounts=[
            AccountMeta(pubkey=payer, is_signer=True, is_writable=True),
            AccountMeta(pubkey=ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=owner, is_signer=False, is_writable=False),
            AccountMeta(pubkey=mint, is_signer=False, is_writable=False),
            AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
            AccountMeta(pubkey=TOKEN_PROGRAM_ID, is_signer=False, is_writable=False),
        ],
        program_id=ATA_PROGRAM_ID,
        data=bytes([]),
    )


def build_spl_transfer_instruction(
    source_ata: Pubkey,
    dest_ata: Pubkey,
    owner: Pubkey,
    amount: int,
) -> Instruction:
    data = bytes([3]) + amount.to_bytes(8, "little")
    return Instruction(
        accounts=[
            AccountMeta(pubkey=source_ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=dest_ata, is_signer=False, is_writable=True),
            AccountMeta(pubkey=owner, is_signer=True, is_writable=False),
        ],
        program_id=TOKEN_PROGRAM_ID,
        data=data,
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

    async def transfer_usdc(self, recipient_pubkey_str: str, amount_usdc: float) -> str:
        recipient = Pubkey.from_string(recipient_pubkey_str)
        treasury = self.treasury_keypair.pubkey()

        treasury_ata = get_ata_address(treasury, USDC_MINT_DEVNET)
        recipient_ata = get_ata_address(recipient, USDC_MINT_DEVNET)

        instructions = []

        recipient_ata_exists = await self.ata_exists(recipient, USDC_MINT_DEVNET)
        if not recipient_ata_exists:
            create_ata_ix = build_create_ata_instruction(
                payer=treasury,
                ata=recipient_ata,
                owner=recipient,
                mint=USDC_MINT_DEVNET,
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

    async def _confirm_transaction(self, signature: str, max_attempts: int = 30):
        from solders.signature import Signature
        sig = Signature.from_string(signature)
        for attempt in range(max_attempts):
            resp = await self.client.get_signature_statuses([sig])
            if resp.value and resp.value[0] is not None:
                status = resp.value[0]
                if status.err:
                    raise RuntimeError(f"Transaction failed: {status.err}")
                if status.confirmation_status in ("confirmed", "finalized"):
                    return
            await asyncio.sleep(1)
        raise TimeoutError(f"Transaction {signature} not confirmed after {max_attempts}s")

    async def close(self):
        await self.client.close()


_solana_service: Optional[SolanaService] = None


def get_solana_service() -> SolanaService:
    global _solana_service
    if _solana_service is None:
        _solana_service = SolanaService()
    return _solana_service
