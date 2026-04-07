use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("JaireEscrw111111111111111111111111111111111");

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Basis points in a full percentage (100 %)
const BPS_DENOMINATOR: u64 = 10_000;

/// Host receives 85 % of booking revenue
const HOST_SHARE_BPS: u64 = 8_500;

/// JaIre treasury receives 15 %
const TREASURY_SHARE_BPS: u64 = 1_500;

/// Maximum booking duration: 24 hours (in seconds)
const MAX_BOOKING_SECONDS: i64 = 86_400;

/// Minimum booking: 1 hour
const MIN_BOOKING_SECONDS: i64 = 3_600;

// ─────────────────────────────────────────────────────────────────────────────
//  Program
// ─────────────────────────────────────────────────────────────────────────────

#[program]
pub mod jaire_escrow {
    use super::*;

    /// Called once by a workspace host to register their space on-chain.
    ///
    /// Parameters
    /// ----------
    /// hourly_rate_usdc : USDC atomic units per hour (6 decimals)
    ///     e.g. 5_000_000 = 5 USDC/hr
    /// capacity         : max simultaneous users
    /// workspace_name   : up to 64 bytes UTF-8 label
    pub fn initialize_workspace(
        ctx: Context<InitializeWorkspace>,
        hourly_rate_usdc: u64,
        capacity: u8,
        workspace_name: String,
    ) -> Result<()> {
        require!(hourly_rate_usdc > 0, JaireError::InvalidRate);
        require!(capacity > 0 && capacity <= 50, JaireError::InvalidCapacity);
        require!(!workspace_name.is_empty() && workspace_name.len() <= 64, JaireError::InvalidName);

        let ws = &mut ctx.accounts.workspace;
        ws.host = ctx.accounts.host.key();
        ws.treasury = ctx.accounts.treasury.key();
        ws.usdc_mint = ctx.accounts.usdc_mint.key();
        ws.hourly_rate_usdc = hourly_rate_usdc;
        ws.capacity = capacity;
        ws.active_sessions = 0;
        ws.total_revenue_usdc = 0;
        ws.workspace_name = workspace_name;
        ws.bump = ctx.bumps.workspace;

        emit!(WorkspaceInitialized {
            workspace: ws.key(),
            host: ws.host,
            hourly_rate_usdc,
            capacity,
        });

        Ok(())
    }

    /// User checks in and locks USDC in the escrow PDA.
    ///
    /// The user pre-pays for `planned_hours` of coworking time.
    /// The escrow holds the full amount; a refund is issued on early check-out.
    pub fn check_in(
        ctx: Context<CheckIn>,
        planned_hours: u8,
    ) -> Result<()> {
        let ws = &mut ctx.accounts.workspace;
        require!(ws.active_sessions < ws.capacity, JaireError::WorkspaceFull);

        let planned_secs = planned_hours as i64 * 3_600;
        require!(
            planned_secs >= MIN_BOOKING_SECONDS && planned_secs <= MAX_BOOKING_SECONDS,
            JaireError::InvalidDuration
        );

        let deposit_amount = ws
            .hourly_rate_usdc
            .checked_mul(planned_hours as u64)
            .ok_or(JaireError::MathOverflow)?;

        // Transfer USDC from user → escrow PDA token account
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_usdc.to_account_info(),
            to: ctx.accounts.escrow_usdc.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            deposit_amount,
        )?;

        let clock = Clock::get()?;
        let session = &mut ctx.accounts.session;
        session.workspace = ws.key();
        session.user = ctx.accounts.user.key();
        session.check_in_ts = clock.unix_timestamp;
        session.planned_hours = planned_hours;
        session.deposit_usdc = deposit_amount;
        session.is_active = true;
        session.bump = ctx.bumps.session;

        ws.active_sessions = ws.active_sessions.saturating_add(1);

        emit!(UserCheckedIn {
            session: session.key(),
            user: session.user,
            workspace: ws.key(),
            deposit_usdc: deposit_amount,
            check_in_ts: session.check_in_ts,
        });

        Ok(())
    }

    /// User checks out; escrow releases USDC with 85/15 split.
    ///
    /// If the user leaves early, they are refunded for unused hours (rounded down).
    /// The fee split is: host 85 %, JaIre treasury 15 %.
    pub fn check_out(ctx: Context<CheckOut>) -> Result<()> {
        require!(ctx.accounts.session.is_active, JaireError::SessionNotActive);

        let clock = Clock::get()?;

        // ── Read all session/workspace values we need before any mutable borrows ──
        let check_in_ts = ctx.accounts.session.check_in_ts;
        let planned_hours = ctx.accounts.session.planned_hours;
        let deposit_usdc = ctx.accounts.session.deposit_usdc;
        let session_bump = ctx.accounts.session.bump;
        let session_user = ctx.accounts.session.user;
        let workspace_key = ctx.accounts.workspace.key();
        let hourly_rate = ctx.accounts.workspace.hourly_rate_usdc;

        let elapsed_secs = clock.unix_timestamp
            .checked_sub(check_in_ts)
            .ok_or(JaireError::MathOverflow)?
            .max(0);

        // Billable hours (rounded up to nearest hour, capped at planned)
        let elapsed_hours = ((elapsed_secs + 3_599) / 3_600) as u64;
        let billable_hours = elapsed_hours.min(planned_hours as u64);
        let billable_usdc = hourly_rate
            .checked_mul(billable_hours)
            .ok_or(JaireError::MathOverflow)?
            .min(deposit_usdc);

        let refund_usdc = deposit_usdc.saturating_sub(billable_usdc);

        let host_amount = billable_usdc
            .checked_mul(HOST_SHARE_BPS)
            .ok_or(JaireError::MathOverflow)?
            / BPS_DENOMINATOR;

        let treasury_amount = billable_usdc
            .checked_mul(TREASURY_SHARE_BPS)
            .ok_or(JaireError::MathOverflow)?
            / BPS_DENOMINATOR;

        // PDA signer seeds — session PDA is the escrow authority
        let seeds: &[&[u8]] = &[
            b"session",
            workspace_key.as_ref(),
            session_user.as_ref(),
            &[session_bump],
        ];
        let signer = &[seeds];

        // Transfer: escrow → host
        if host_amount > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.escrow_usdc.to_account_info(),
                to: ctx.accounts.host_usdc.to_account_info(),
                authority: ctx.accounts.session.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                ),
                host_amount,
            )?;
        }

        // Transfer: escrow → treasury
        if treasury_amount > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.escrow_usdc.to_account_info(),
                to: ctx.accounts.treasury_usdc.to_account_info(),
                authority: ctx.accounts.session.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                ),
                treasury_amount,
            )?;
        }

        // Refund unused deposit → user
        if refund_usdc > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.escrow_usdc.to_account_info(),
                to: ctx.accounts.user_usdc.to_account_info(),
                authority: ctx.accounts.session.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                ),
                refund_usdc,
            )?;
        }

        // ── Now mutably update state ──
        let ws = &mut ctx.accounts.workspace;
        ws.active_sessions = ws.active_sessions.saturating_sub(1);
        ws.total_revenue_usdc = ws
            .total_revenue_usdc
            .saturating_add(host_amount + treasury_amount);

        let session = &mut ctx.accounts.session;
        session.is_active = false;
        let check_out_ts = clock.unix_timestamp;

        emit!(UserCheckedOut {
            session: session.key(),
            user: session_user,
            workspace: workspace_key,
            billable_usdc,
            host_amount,
            treasury_amount,
            refund_usdc,
            check_out_ts,
        });

        Ok(())
    }

    /// Host updates the hourly rate or capacity of their workspace.
    pub fn update_workspace(
        ctx: Context<UpdateWorkspace>,
        new_hourly_rate_usdc: Option<u64>,
        new_capacity: Option<u8>,
    ) -> Result<()> {
        let ws = &mut ctx.accounts.workspace;
        if let Some(rate) = new_hourly_rate_usdc {
            require!(rate > 0, JaireError::InvalidRate);
            ws.hourly_rate_usdc = rate;
        }
        if let Some(cap) = new_capacity {
            require!(cap > 0 && cap <= 50, JaireError::InvalidCapacity);
            require!(cap >= ws.active_sessions, JaireError::CapacityBelowActive);
            ws.capacity = cap;
        }
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Accounts
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(hourly_rate_usdc: u64, capacity: u8, workspace_name: String)]
pub struct InitializeWorkspace<'info> {
    #[account(
        init,
        payer = host,
        space = WorkspaceState::LEN,
        seeds = [b"workspace", host.key().as_ref()],
        bump,
    )]
    pub workspace: Account<'info, WorkspaceState>,

    #[account(mut)]
    pub host: Signer<'info>,

    /// CHECK: Treasury is a known address validated off-chain
    pub treasury: UncheckedAccount<'info>,

    /// CHECK: USDC mint address validated off-chain (devnet / mainnet)
    pub usdc_mint: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CheckIn<'info> {
    #[account(
        mut,
        seeds = [b"workspace", workspace.host.as_ref()],
        bump = workspace.bump,
    )]
    pub workspace: Account<'info, WorkspaceState>,

    #[account(
        init,
        payer = user,
        space = SessionState::LEN,
        seeds = [b"session", workspace.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub session: Account<'info, SessionState>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// User's USDC token account (source of funds)
    #[account(mut, token::mint = workspace.usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,

    /// Escrow USDC token account — authority is the session PDA
    #[account(
        mut,
        token::mint = workspace.usdc_mint,
        token::authority = session,
    )]
    pub escrow_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CheckOut<'info> {
    #[account(
        mut,
        seeds = [b"workspace", workspace.host.as_ref()],
        bump = workspace.bump,
    )]
    pub workspace: Account<'info, WorkspaceState>,

    #[account(
        mut,
        seeds = [b"session", workspace.key().as_ref(), session.user.as_ref()],
        bump = session.bump,
        constraint = session.workspace == workspace.key() @ JaireError::WorkspaceMismatch,
        constraint = session.is_active @ JaireError::SessionNotActive,
    )]
    pub session: Account<'info, SessionState>,

    /// The user who checked in (must sign check-out)
    #[account(constraint = user.key() == session.user @ JaireError::Unauthorized)]
    pub user: Signer<'info>,

    /// User's USDC account — receives refund if applicable
    #[account(mut, token::mint = workspace.usdc_mint)]
    pub user_usdc: Account<'info, TokenAccount>,

    /// Escrow USDC account (source on checkout)
    #[account(
        mut,
        token::mint = workspace.usdc_mint,
        token::authority = session,
    )]
    pub escrow_usdc: Account<'info, TokenAccount>,

    /// Host's USDC account — receives 85 %
    #[account(mut, token::mint = workspace.usdc_mint)]
    pub host_usdc: Account<'info, TokenAccount>,

    /// JaIre treasury USDC account — receives 15 %
    #[account(
        mut,
        token::mint = workspace.usdc_mint,
        constraint = treasury_usdc.owner == workspace.treasury @ JaireError::Unauthorized,
    )]
    pub treasury_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateWorkspace<'info> {
    #[account(
        mut,
        seeds = [b"workspace", host.key().as_ref()],
        bump = workspace.bump,
        constraint = workspace.host == host.key() @ JaireError::Unauthorized,
    )]
    pub workspace: Account<'info, WorkspaceState>,

    pub host: Signer<'info>,
}

// ─────────────────────────────────────────────────────────────────────────────
//  State Accounts
// ─────────────────────────────────────────────────────────────────────────────

#[account]
pub struct WorkspaceState {
    pub host: Pubkey,           // 32
    pub treasury: Pubkey,       // 32
    pub usdc_mint: Pubkey,      // 32
    pub hourly_rate_usdc: u64,  // 8
    pub capacity: u8,           // 1
    pub active_sessions: u8,    // 1
    pub total_revenue_usdc: u64,// 8
    pub workspace_name: String, // 4 + 64
    pub bump: u8,               // 1
}

impl WorkspaceState {
    pub const LEN: usize = 8   // discriminator
        + 32 + 32 + 32         // host, treasury, usdc_mint
        + 8 + 1 + 1 + 8        // rate, capacity, active, revenue
        + 4 + 64               // workspace_name (String prefix + max 64 bytes)
        + 1;                   // bump
}

#[account]
pub struct SessionState {
    pub workspace: Pubkey,   // 32
    pub user: Pubkey,        // 32
    pub check_in_ts: i64,    // 8
    pub planned_hours: u8,   // 1
    pub deposit_usdc: u64,   // 8
    pub is_active: bool,     // 1
    pub bump: u8,            // 1
}

impl SessionState {
    pub const LEN: usize = 8 // discriminator
        + 32 + 32             // workspace, user
        + 8 + 1 + 8 + 1 + 1; // ts, hours, deposit, active, bump
}

// ─────────────────────────────────────────────────────────────────────────────
//  Events
// ─────────────────────────────────────────────────────────────────────────────

#[event]
pub struct WorkspaceInitialized {
    pub workspace: Pubkey,
    pub host: Pubkey,
    pub hourly_rate_usdc: u64,
    pub capacity: u8,
}

#[event]
pub struct UserCheckedIn {
    pub session: Pubkey,
    pub user: Pubkey,
    pub workspace: Pubkey,
    pub deposit_usdc: u64,
    pub check_in_ts: i64,
}

#[event]
pub struct UserCheckedOut {
    pub session: Pubkey,
    pub user: Pubkey,
    pub workspace: Pubkey,
    pub billable_usdc: u64,
    pub host_amount: u64,
    pub treasury_amount: u64,
    pub refund_usdc: u64,
    pub check_out_ts: i64,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum JaireError {
    #[msg("Hourly rate must be greater than zero")]
    InvalidRate,
    #[msg("Capacity must be between 1 and 50")]
    InvalidCapacity,
    #[msg("New capacity cannot be less than the number of active sessions")]
    CapacityBelowActive,
    #[msg("Workspace name must be 1–64 characters")]
    InvalidName,
    #[msg("Workspace is at full capacity")]
    WorkspaceFull,
    #[msg("Booking duration must be between 1 and 24 hours")]
    InvalidDuration,
    #[msg("Session is not active")]
    SessionNotActive,
    #[msg("Workspace mismatch in session")]
    WorkspaceMismatch,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Unauthorized signer")]
    Unauthorized,
}
