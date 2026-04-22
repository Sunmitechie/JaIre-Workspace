use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

declare_id!("Gq5D4wB5yaAyK4M5mP82cJ1JnZJ2qypuZ7z5DjJ9WzGJ");

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const BPS_DENOMINATOR: u64 = 10_000;
const HOST_SHARE_BPS: u64 = 8_500;     // 85 % to workspace host
const TREASURY_SHARE_BPS: u64 = 1_500; // 15 % to JaIre treasury
const MAX_BOOKING_SECONDS: u64 = 86_400;
const MIN_BOOKING_SECONDS: u64 = 300;  // 5 minutes
const DUST_THRESHOLD: u64 = 1_000;     // 0.001 USDC — skip micro-refunds

// ─────────────────────────────────────────────────────────────────────────────
//  Program
// ─────────────────────────────────────────────────────────────────────────────

#[program]
pub mod jaire_escrow {
    use super::*;

    /// Initialize a session escrow (called at QR check-in).
    ///
    /// Creates a PDA seeded by [user_wallet + booking_id].
    /// USDC is transferred from the user's wallet into the escrow token account.
    /// The escrow token account is owned by the session PDA — no human can touch it.
    ///
    /// Parameters
    /// ----------
    /// booking_id      : 8-byte unique booking identifier (first 8 bytes of UUID)
    /// planned_seconds : pre-paid duration in seconds (300 – 86400)
    /// escrow_usdc     : atomic USDC units to lock (per_second_rate × planned_seconds)
    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        booking_id: [u8; 8],
        planned_seconds: u64,
        escrow_usdc: u64,
    ) -> Result<()> {
        require!(
            planned_seconds >= MIN_BOOKING_SECONDS && planned_seconds <= MAX_BOOKING_SECONDS,
            JaireError::InvalidDuration,
        );
        require!(escrow_usdc > 0, JaireError::InvalidAmount);

        // Transfer USDC: user wallet → escrow token account (PDA-owned)
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_usdc.to_account_info(),
            to: ctx.accounts.escrow_usdc.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            escrow_usdc,
        )?;

        let clock = Clock::get()?;
        let session = &mut ctx.accounts.session;
        session.user = ctx.accounts.user.key();
        session.org_wallet = ctx.accounts.org_wallet.key();
        session.treasury = ctx.accounts.treasury.key();
        session.booking_id = booking_id;
        session.check_in_ts = clock.unix_timestamp;
        session.planned_seconds = planned_seconds;
        session.deposit_usdc = escrow_usdc;
        session.is_active = true;
        session.bump = ctx.bumps.session;
        session.escrow_bump = ctx.bumps.escrow_usdc;

        emit!(SessionOpened {
            session: session.key(),
            user: session.user,
            booking_id,
            deposit_usdc: escrow_usdc,
            planned_seconds,
            check_in_ts: session.check_in_ts,
        });

        Ok(())
    }

    /// Settle and close a session escrow (called at QR check-out by the backend).
    ///
    /// The treasury keypair signs this — the backend triggers settlement after
    /// the user scans the check-out QR code and MQTT records the timestamp.
    ///
    /// Atomic settlement (one transaction):
    ///   time_cost       = per_second_rate × duration_seconds   (from backend/MQTT)
    ///   host_amount     = time_cost × 85 %   → org_wallet USDC
    ///   treasury_amount = time_cost × 15 %   → treasury USDC
    ///   refund          = deposit − time_cost → user USDC
    ///
    /// After transfers the escrow token account is closed and the session PDA
    /// is closed — the SOL rent (~0.002 SOL) returns to the treasury wallet.
    ///
    /// Parameters
    /// ----------
    /// duration_seconds : actual session length in seconds (verified by MQTT timestamps)
    pub fn settle_session(
        ctx: Context<SettleSession>,
        duration_seconds: u64,
    ) -> Result<()> {
        require!(ctx.accounts.session.is_active, JaireError::SessionNotActive);

        let session = &ctx.accounts.session;

        // Cap duration at what was pre-paid
        let billable_seconds = duration_seconds.min(session.planned_seconds);
        let deposit_usdc = session.deposit_usdc;
        let booking_id = session.booking_id;
        let session_user = session.user;
        let session_bump = session.bump;
        let escrow_bump = session.escrow_bump;

        // Per-second rate derived from deposit and planned seconds
        // time_cost = deposit × (billable / planned)  — avoids storing rate on-chain
        let time_cost_usdc = if session.planned_seconds > 0 {
            deposit_usdc
                .checked_mul(billable_seconds)
                .ok_or(JaireError::MathOverflow)?
                / session.planned_seconds
        } else {
            deposit_usdc
        };
        let time_cost_usdc = time_cost_usdc.min(deposit_usdc);

        // 85 % → host (org wallet)
        let host_amount = time_cost_usdc
            .checked_mul(HOST_SHARE_BPS)
            .ok_or(JaireError::MathOverflow)?
            / BPS_DENOMINATOR;

        // 15 % → JaIre treasury
        let treasury_amount = time_cost_usdc
            .checked_mul(TREASURY_SHARE_BPS)
            .ok_or(JaireError::MathOverflow)?
            / BPS_DENOMINATOR;

        // 100 % of unused deposit → refunded to user
        let refund_usdc = deposit_usdc.saturating_sub(time_cost_usdc);
        let refund_to_send = if refund_usdc >= DUST_THRESHOLD { refund_usdc } else { 0 };

        // PDA signer seeds: session PDA controls the escrow token account
        let seeds: &[&[u8]] = &[
            b"session",
            session_user.as_ref(),
            &booking_id,
            &[session_bump],
        ];
        let signer = &[seeds];

        // Escrow token account seeds for its own PDA
        let escrow_seeds: &[&[u8]] = &[
            b"escrow",
            session_user.as_ref(),
            &booking_id,
            &[escrow_bump],
        ];
        let escrow_signer = &[escrow_seeds];

        // ── 1. Escrow → Org wallet (85 % of time_cost) ───────────────────────
        if host_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow_usdc.to_account_info(),
                        to: ctx.accounts.host_usdc.to_account_info(),
                        authority: ctx.accounts.escrow_usdc.to_account_info(),
                    },
                    escrow_signer,
                ),
                host_amount,
            )?;
        }

        // ── 2. Escrow → Treasury (15 % of time_cost) ─────────────────────────
        if treasury_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow_usdc.to_account_info(),
                        to: ctx.accounts.treasury_usdc.to_account_info(),
                        authority: ctx.accounts.escrow_usdc.to_account_info(),
                    },
                    escrow_signer,
                ),
                treasury_amount,
            )?;
        }

        // ── 3. Escrow → User (unused deposit refund) ──────────────────────────
        if refund_to_send > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow_usdc.to_account_info(),
                        to: ctx.accounts.user_usdc.to_account_info(),
                        authority: ctx.accounts.escrow_usdc.to_account_info(),
                    },
                    escrow_signer,
                ),
                refund_to_send,
            )?;
        }

        // ── 4. Close escrow token account → rent back to treasury ─────────────
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.escrow_usdc.to_account_info(),
                destination: ctx.accounts.treasury.to_account_info(),
                authority: ctx.accounts.escrow_usdc.to_account_info(),
            },
            escrow_signer,
        ))?;

        // ── 5. Mark session inactive (session PDA closed via `close` constraint)
        let session = &mut ctx.accounts.session;
        session.is_active = false;

        emit!(SessionSettled {
            user: session_user,
            booking_id,
            billable_seconds,
            time_cost_usdc,
            host_amount,
            treasury_amount,
            refund_usdc: refund_to_send,
        });

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Account Contexts
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(booking_id: [u8; 8], planned_seconds: u64, escrow_usdc: u64)]
pub struct InitializeEscrow<'info> {
    /// Session PDA — uniquely ties this escrow to one user + booking
    #[account(
        init,
        payer = user,
        space = SessionState::LEN,
        seeds = [b"session", user.key().as_ref(), &booking_id],
        bump,
    )]
    pub session: Account<'info, SessionState>,

    /// Escrow token account — PDA-owned, no human has the private key
    #[account(
        init,
        payer = user,
        token::mint = usdc_mint,
        token::authority = escrow_usdc,
        seeds = [b"escrow", user.key().as_ref(), &booking_id],
        bump,
    )]
    pub escrow_usdc: Account<'info, TokenAccount>,

    /// User's wallet — signs the transaction, authorises USDC transfer out
    #[account(mut)]
    pub user: Signer<'info>,

    /// User's USDC token account (source)
    #[account(mut, token::mint = usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,

    /// USDC mint (devnet test mint or mainnet USDC)
    /// CHECK: validated off-chain (matches stored workspace config)
    pub usdc_mint: UncheckedAccount<'info>,

    /// Org wallet — stored in session so checkout can pay it without an extra param
    /// CHECK: any pubkey; validated off-chain against the workspace record
    pub org_wallet: UncheckedAccount<'info>,

    /// JaIre treasury — stored in session for the 15 % cut at checkout
    /// CHECK: validated off-chain (matches JAIRE_VAULT_ADDRESS secret)
    pub treasury: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(duration_seconds: u64)]
pub struct SettleSession<'info> {
    /// Session PDA — closed here; rent returns to treasury
    #[account(
        mut,
        seeds = [b"session", session.user.as_ref(), &session.booking_id],
        bump = session.bump,
        constraint = session.is_active @ JaireError::SessionNotActive,
        close = treasury,
    )]
    pub session: Account<'info, SessionState>,

    /// Escrow token account — closed after all transfers; rent returns to treasury
    #[account(
        mut,
        seeds = [b"escrow", session.user.as_ref(), &session.booking_id],
        bump = session.escrow_bump,
        token::mint = usdc_mint,
    )]
    pub escrow_usdc: Account<'info, TokenAccount>,

    /// USDC mint
    /// CHECK: validated off-chain
    pub usdc_mint: UncheckedAccount<'info>,

    /// JaIre treasury keypair — signs this instruction (backend triggers settlement)
    #[account(mut, constraint = treasury.key() == session.treasury @ JaireError::Unauthorized)]
    pub treasury: Signer<'info>,

    /// Treasury USDC token account — receives 15 % cut + escrow rent SOL
    #[account(mut, token::mint = usdc_mint)]
    pub treasury_usdc: Account<'info, TokenAccount>,

    /// Org (host) USDC token account — receives 85 %
    #[account(
        mut,
        token::mint = usdc_mint,
        constraint = host_usdc.owner == session.org_wallet @ JaireError::Unauthorized,
    )]
    pub host_usdc: Account<'info, TokenAccount>,

    /// User USDC token account — receives unused deposit refund
    #[account(
        mut,
        token::mint = usdc_mint,
        constraint = user_usdc.owner == session.user @ JaireError::Unauthorized,
    )]
    pub user_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ─────────────────────────────────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────────────────────────────────

#[account]
pub struct SessionState {
    pub user: Pubkey,             // 32 — user wallet (matches seed)
    pub org_wallet: Pubkey,       // 32 — org receives 85 % at checkout
    pub treasury: Pubkey,         // 32 — JaIre vault receives 15 %
    pub booking_id: [u8; 8],      //  8 — matches seed
    pub check_in_ts: i64,         //  8 — unix timestamp of check-in
    pub planned_seconds: u64,     //  8 — pre-paid duration
    pub deposit_usdc: u64,        //  8 — total USDC locked
    pub is_active: bool,          //  1
    pub bump: u8,                 //  1 — session PDA bump
    pub escrow_bump: u8,          //  1 — escrow token account PDA bump
}

impl SessionState {
    pub const LEN: usize = 8          // discriminator
        + 32 + 32 + 32                // user, org_wallet, treasury
        + 8                           // booking_id
        + 8 + 8 + 8                   // check_in_ts, planned_seconds, deposit_usdc
        + 1 + 1 + 1;                  // is_active, bump, escrow_bump
}

// ─────────────────────────────────────────────────────────────────────────────
//  Events
// ─────────────────────────────────────────────────────────────────────────────

#[event]
pub struct SessionOpened {
    pub session: Pubkey,
    pub user: Pubkey,
    pub booking_id: [u8; 8],
    pub deposit_usdc: u64,
    pub planned_seconds: u64,
    pub check_in_ts: i64,
}

#[event]
pub struct SessionSettled {
    pub user: Pubkey,
    pub booking_id: [u8; 8],
    pub billable_seconds: u64,
    pub time_cost_usdc: u64,
    pub host_amount: u64,       // 85 % → org
    pub treasury_amount: u64,   // 15 % → JaIre
    pub refund_usdc: u64,       // unused → user
}

// ─────────────────────────────────────────────────────────────────────────────
//  Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum JaireError {
    #[msg("Booking duration must be 5 minutes – 24 hours")]
    InvalidDuration,
    #[msg("USDC escrow amount must be greater than zero")]
    InvalidAmount,
    #[msg("Session is not active")]
    SessionNotActive,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Unauthorized signer")]
    Unauthorized,
}
