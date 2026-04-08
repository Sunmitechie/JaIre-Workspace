"""
DevNet testing utilities.

Sets up a self-hosted test USDC mint controlled by the treasury keypair.
Lets us airdrop SOL + mint test USDC without relying on public faucets.
"""
import asyncio
import logging
import struct
from typing import Optional

from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.message import Message
from solders.transaction import Transaction
from solders.system_program import create_account, CreateAccountParams
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.rpc.types import TxOpts
from spl.token.instructions import initialize_mint, InitializeMintParams

from app.config import settings
from app.services.solana_service import (
    SolanaService,
    get_solana_service,
    get_ata_address,
    build_create_ata_instruction,
    build_mint_to_instruction,
    TOKEN_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    SYSVAR_RENT_PUBKEY,
    USDC_DECIMALS,
)

logger = logging.getLogger(__name__)

# Devnet USDC mint we'll create (controlled by treasury)
# This is stored in the DB / env after first initialization
_TEST_MINT_PUBKEY: Optional[str] = None


def _build_initialize_mint_instruction(
    mint: Pubkey,
    decimals: int,
    mint_authority: Pubkey,
    freeze_authority: Optional[Pubkey] = None,
):
    """Build an InitializeMint instruction using the SPL token library."""
    return initialize_mint(
        InitializeMintParams(
            program_id=TOKEN_PROGRAM_ID,
            mint=mint,
            decimals=decimals,
            mint_authority=mint_authority,
            freeze_authority=freeze_authority,
        )
    )


class DevnetSetupService:
    """Creates and manages a treasury-controlled USDC mint for devnet testing."""

    MINT_ACCOUNT_SIZE = 82  # SPL Mint account size

    def __init__(self, svc: SolanaService):
        self.svc = svc
        self.client = svc.client
        self.treasury = svc.treasury_keypair
        self.treasury_pubkey = svc.treasury_pubkey

    async def ensure_sol_funded(self, min_sol: float = 0.5) -> float:
        """Airdrop SOL to treasury if balance is below min_sol. Returns new balance."""
        balance = await self.svc.get_sol_balance(str(self.treasury_pubkey))
        if balance >= min_sol:
            logger.info(f"Treasury SOL balance OK: {balance:.4f}")
            return balance

        logger.info(f"Treasury has {balance:.4f} SOL, requesting airdrop...")
        try:
            lamports = int(1.0 * 1_000_000_000)
            resp = await self.client.request_airdrop(self.treasury_pubkey, lamports, commitment=Confirmed)
            if resp.value:
                await self.svc._confirm_transaction(str(resp.value))
                balance = await self.svc.get_sol_balance(str(self.treasury_pubkey))
                logger.info(f"Treasury SOL after airdrop: {balance:.4f}")
        except Exception as e:
            logger.warning(f"Airdrop failed: {e}")
        return balance

    async def create_test_mint(self) -> str:
        """
        Create a new SPL token mint controlled by the treasury.
        Returns the mint pubkey string.
        """
        global _TEST_MINT_PUBKEY

        mint_keypair = Keypair()
        mint_pubkey = mint_keypair.pubkey()

        # Get rent exemption for mint account
        rent_resp = await self.client.get_minimum_balance_for_rent_exemption(self.MINT_ACCOUNT_SIZE)
        rent = rent_resp.value

        blockhash_resp = await self.client.get_latest_blockhash(commitment=Confirmed)
        blockhash = blockhash_resp.value.blockhash

        # Create account + Initialize mint in one tx
        create_ix = create_account(CreateAccountParams(
            from_pubkey=self.treasury_pubkey,
            to_pubkey=mint_pubkey,
            lamports=rent,
            space=self.MINT_ACCOUNT_SIZE,
            owner=TOKEN_PROGRAM_ID,
        ))

        init_mint_ix = _build_initialize_mint_instruction(
            mint=mint_pubkey,
            decimals=USDC_DECIMALS,
            mint_authority=self.treasury_pubkey,
        )

        msg = Message.new_with_blockhash(
            [create_ix, init_mint_ix],
            self.treasury_pubkey,
            blockhash,
        )
        tx = Transaction([self.treasury, mint_keypair], msg, blockhash)

        resp = await self.client.send_transaction(tx, opts=TxOpts(skip_preflight=False, preflight_commitment=Confirmed))
        sig = str(resp.value)
        await self.svc._confirm_transaction(sig)

        mint_str = str(mint_pubkey)
        _TEST_MINT_PUBKEY = mint_str
        logger.info(f"Created test USDC mint: {mint_str} (sig: {sig})")
        return mint_str

    async def mint_test_usdc(self, recipient_pubkey_str: str, amount_usdc: float, mint_pubkey_str: str) -> str:
        """
        Mint test USDC tokens to a recipient's ATA.
        Creates the ATA if it doesn't exist.
        """
        recipient = Pubkey.from_string(recipient_pubkey_str)
        mint = Pubkey.from_string(mint_pubkey_str)
        recipient_ata = get_ata_address(recipient, mint)

        instructions = []

        # Check/create ATA
        ata_resp = await self.client.get_account_info(recipient_ata, commitment=Confirmed)
        if ata_resp.value is None:
            create_ata_ix = build_create_ata_instruction(
                payer=self.treasury_pubkey,
                ata=recipient_ata,
                owner=recipient,
                mint=mint,
            )
            instructions.append(create_ata_ix)

        raw_amount = int(amount_usdc * (10 ** USDC_DECIMALS))
        mint_ix = build_mint_to_instruction(
            mint=mint,
            dest=recipient_ata,
            mint_authority=self.treasury_pubkey,
            amount=raw_amount,
        )
        instructions.append(mint_ix)

        blockhash_resp = await self.client.get_latest_blockhash(commitment=Confirmed)
        blockhash = blockhash_resp.value.blockhash
        msg = Message.new_with_blockhash(instructions, self.treasury_pubkey, blockhash)
        tx = Transaction([self.treasury], msg, blockhash)

        resp = await self.client.send_transaction(tx, opts=TxOpts(skip_preflight=False, preflight_commitment=Confirmed))
        sig = str(resp.value)
        await self.svc._confirm_transaction(sig)
        logger.info(f"Minted {amount_usdc} test USDC to {recipient_pubkey_str} (sig: {sig})")
        return sig


_devnet_setup: Optional[DevnetSetupService] = None


def get_devnet_setup() -> DevnetSetupService:
    global _devnet_setup
    if _devnet_setup is None:
        _devnet_setup = DevnetSetupService(get_solana_service())
    return _devnet_setup


def set_test_mint(mint_pubkey_str: str) -> None:
    """Register an already-created mint address (e.g., one created in a previous session)."""
    global _TEST_MINT_PUBKEY
    _TEST_MINT_PUBKEY = mint_pubkey_str
    logger.info(f"Registered existing test mint: {mint_pubkey_str}")


def get_test_mint() -> Optional[str]:
    return _TEST_MINT_PUBKEY
