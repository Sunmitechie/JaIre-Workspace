# JaIre — Blockchain Nomads Coworking Platform

## Overview

Web2.5 coworking workspace booking platform for "Blockchain Nomads." Users pay in Naira (NGN) via Paystack/Roqqu; the backend invisibly converts to USDC and settles on Solana via Web3Auth MPC wallets.

**Architecture**: pnpm monorepo with Python FastAPI backend + Node.js Express proxy + Node.js MPC sidecar + Anchor smart contract (Rust).

---

## Services

| Service | Port | Language | Purpose |
|---------|------|----------|---------|
| Express API Proxy | 8080 | TypeScript | Routes all traffic; forwards `/jaire/*` → Python |
| JaIre Python API | 8000 | Python 3.11 | Core: wallets, payments, Solana, DB |
| MPC Sidecar | 9000 | TypeScript | Web3Auth JWT verify + key-factor share derivation |
| Anchor Program | — | Rust | Escrow smart contract (85/15 split) |

---

## Stack

### Node.js / TypeScript
- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **TypeScript version**: 5.9
- **API framework**: Express 5 (proxy + sidecar)
- **Database**: PostgreSQL + Drizzle ORM
- **MPC lib**: jose (JWT), @solana/web3.js, bs58

### Python
- **Framework**: FastAPI + uvicorn (--reload)
- **ORM**: SQLAlchemy (async) + asyncpg
- **Solana**: solana-py + solders
- **Config**: pydantic-settings
- **Install path**: `.pythonlibs/`

### Rust / Solana
- **Framework**: Anchor 0.31.0 (compiling via `cargo install --git`)
- **Program**: `programs/jaire-escrow/programs/jaire-escrow/src/lib.rs`
- **Network**: Devnet → Mainnet-beta

---

## Key Files

```
artifacts/
  api-server/src/app.ts          # Express proxy; forwards /jaire/* to :8000
  jaire-python/
    main.py                      # FastAPI app + startup
    app/config.py                # Settings (pydantic-settings; reads env vars)
    app/database.py              # Async SQLAlchemy engine + table creation
    app/services/
      solana_service.py          # SOL/USDC transfers, ATA management, treasury
      payment_service.py         # NGN→USDC rate, wallet create, payment record
      devnet_setup.py            # Devnet test helpers: mint creation, test USDC
    app/routers/
      wallets.py                 # POST /jaire/wallet/create
      payments.py                # POST /jaire/payment/initiate
      webhooks.py                # POST /jaire/webhook/paystack, /roqqu
      devnet.py                  # GET/POST /jaire/devnet/*

services/
  mpc-sidecar/src/
    index.ts                     # Entry point — port 9000
    config.ts                    # Reads WEB3AUTH_* env vars
    services/mpc-service.ts      # JWT verify, factor share, wallet derivation
    routes/mpc.ts                # POST /mpc/factor-share, /mpc/wallet, /mpc/verify-token
    routes/health.ts             # GET /health

programs/
  jaire-escrow/
    Anchor.toml                  # Anchor workspace config (devnet)
    Cargo.toml                   # Workspace root
    programs/jaire-escrow/src/lib.rs  # Smart contract: check-in/out, 85/15 split
```

---

## Environment Variables / Secrets

| Key | Where set | Purpose |
|-----|-----------|---------|
| `JAIRE_TREASURY_PRIVATE_KEY` | Replit Secret | 32-byte hex; treasury Solana keypair |
| `WEB3AUTH_CLIENT_ID` | Replit Secret | Web3Auth project client ID |
| `WEB3AUTH_NODE_FACTOR_KEY` | Replit Secret | HMAC key for MPC factor share derivation |
| `SESSION_SECRET` | Replit Secret | Express session encryption |
| `SOLANA_RPC_URL` | Replit Secret | Helius devnet RPC endpoint |
| `DATABASE_URL` | Runtime-managed | PostgreSQL connection (set by Replit DB) |

---

## Database Tables (PostgreSQL, `jaire_` prefix)

- `jaire_users` — user_id (UUID PK), identifier, name, created_at
- `jaire_wallets` — id, user_id (FK), pubkey, encrypted_secret, network, created_at
- `jaire_payments` — id, user_id, amount_ngn, amount_usdc, status, tx_signature, ...

---

## Key Constants

- **Treasury pubkey**: `JDtjhBDwv3WwJpQR1LAcC9kTCwr4sbZhdEYVmKPcxRE`
- **Devnet USDC mint**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- **NGN→USDC rate**: 1600 NGN/USDC (configurable via `NGN_USDC_RATE` env)
- **Escrow split**: 85% host / 15% treasury
- **Booking limits**: 1–24 hours

---

## Devnet Testing Flow

1. **Fund treasury SOL**: `POST /jaire/devnet/setup/fund-treasury` (or use `https://faucet.solana.com`)
2. **Create test mint**: `POST /jaire/devnet/setup/create-test-mint` → get `test_mint` pubkey
3. **Mint test USDC**: `POST /jaire/devnet/setup/mint-usdc` with `{recipient, amount_usdc, mint_pubkey}`
4. **Check balances**: `GET /jaire/devnet/balance-for-mint/{pubkey}/{mint}`
5. **Test payment**: `POST /jaire/payment/initiate` with test mode enabled

> **Note**: Devnet faucets (api.devnet.solana.com, Helius) have daily rate limits (1 SOL/day/IP). Use `https://faucet.solana.com` manually when rate-limited.

---

## MPC Architecture

The Node.js sidecar (`services/mpc-sidecar`) holds the **node factor key** (one of three key shares in Web3Auth's TSS):
- **Web3Auth network shares**: Held by Web3Auth's distributed nodes
- **Device share**: Held on the user's device (or social recovery)
- **Node factor share**: Derived deterministically via HMAC-SHA256 from `WEB3AUTH_NODE_FACTOR_KEY + verifierId`

The frontend MPC Core Kit SDK combines all three to reach threshold and sign transactions — **no single party ever holds the full private key** (except in devnet simulation mode).

---

## Anchor Smart Contract

`jaire-escrow` program implements:
- `initialize_workspace(hourly_rate, capacity, name)` — Host registers a workspace
- `check_in(planned_hours)` — User locks USDC in session PDA escrow
- `check_out()` — Releases USDC: 85% host, 15% treasury; refunds unused hours
- `update_workspace(rate?, capacity?)` — Host config update

State accounts: `WorkspaceState` (PDA: `["workspace", host]`), `SessionState` (PDA: `["session", workspace, user]`)

---

## Next Steps

- [ ] Fund treasury with SOL on devnet (use faucet.solana.com manually)
- [ ] Complete Anchor CLI install and `anchor build` / `anchor deploy`
- [ ] Wire payment flow: Paystack webhook → USDC transfer → session record
- [ ] Kamino Finance yield integration (idle USDC earns yield)
- [ ] Baire AI agent (OpenAI Realtime API + LangGraph voice concierge)
- [ ] Jaie Analytics (MQTT + host-facing CRO dashboard)
- [ ] React frontend (Golden Yellow + Sky Blue + Purple, fintech design)
- [ ] Solana Blinks for social media booking
