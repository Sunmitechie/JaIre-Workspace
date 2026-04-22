# JaIre — Blockchain Nomads Coworking Platform

## Overview

Web2.5 coworking workspace booking platform for "Blockchain Nomads." Users pay in Naira (NGN) via Paystack/Roqqu; the backend invisibly converts to USDC and settles on Solana via Web3Auth MPC wallets. Every Solana transaction includes a `JAIRE|TYPE|REF` on-chain memo. Workspace providers onboard via the Org Dashboard with Web3Auth signup + KYC.

**Architecture**: pnpm monorepo with Python FastAPI backend + Node.js Express proxy + Node.js MPC sidecar + Anchor smart contract (Rust).

---

## Services & Workflows

| Service | Port | Workflow Name | Language | Purpose |
|---------|------|---------------|----------|---------|
| JaIre App (Vite) | 5173 | JaIre App | TypeScript/React | Frontend — Baire UI, booking flows, wallet management |
| Express API + Baire | 8080 | JaIre API Server | TypeScript | Baire AI agent, payments, proxy to Python/MPC |
| JaIre Python API | 8000 | JaIre Python API | Python 3.11 | Core: wallets, payments, Solana, DB |
| MPC Sidecar | 9000 | JaIre MPC Sidecar | TypeScript | Web3Auth JWT verify + key-factor share derivation |
| Anchor Program | — | — | Rust | Escrow smart contract (85/15 split) |

### Proxy routing (via Vite dev proxy → api-server)
- `/api/*` → api-server (port 8080)
- `/jaire/*` → Python API (port 8000, via api-server)
- `/mpc/*` → MPC Sidecar (port 9000, via api-server)

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
    services/solana-wallet.ts    # Solana transfers, vault/treasury keypair management
    services/anchor-escrow.ts    # Escrow service: initializeEscrow + settleSession (85/15 atomic)
    services/memo.ts             # Shared SPL Memo instruction builder
    routes/mpc.ts                # All MPC endpoints including /mpc/escrow/initialize & /mpc/escrow/settle
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

## Baire AI Agent (COMPLETE)

Baire is JaIre's voice-to-voice AI concierge built on LangGraph + gpt-5.2 via Replit AI Integration.

**Voice pipeline**: Audio in → STT (gpt-4o-mini-transcribe) → LangGraph ReAct agent (gpt-5.2 + tools) → TTS (gpt-audio/nova) → Audio SSE stream out

**Files:**
- `artifacts/api-server/src/agents/baire-agent.ts` — LangGraph createReactAgent with system prompt
- `artifacts/api-server/src/agents/baire-tools.ts` — JaIre custom tools (workspaces, pricing, wallet balance)
- `artifacts/api-server/src/agents/baire-solana.ts` — Solana Agent Kit (read-only, createLangchainTools)
- `artifacts/api-server/src/routes/baire.ts` — REST routes

**Baire API Endpoints (mounted at `/api/...`):**
- `POST /api/baire/conversations` — Create conversation (returns `{id, title}`)
- `GET /api/baire/conversations/:id/messages` — Get history
- `POST /api/baire/conversations/:id/messages` — Text message → SSE stream (`{ type: "text", content }`)
- `POST /api/baire/conversations/:id/voice-messages` — Multipart audio → SSE (`user_transcript`, `agent_text`, `audio_chunk`, `done`)
- `POST /api/baire/voice-quick` — Stateless voice (no conversation history) for quick demos

**Baire Tools:**
- `list_workspaces` — 4 spaces: Hub, Founders Suite, Blockchain Lounge, Board Room
- `calculate_booking_price` — NGN + USDC with duration
- `check_wallet_balance` — Calls Python API by email/phone
- `get_exchange_rate` — Internal JaIre NGN/USDC rate
- `get_jaire_info` — General/payments/wallet/solana/booking info
- Solana Agent Kit tools (balance, token info) for blockchain queries

**DB Tables:**
- `conversations` — id, title, created_at
- `messages` — id, conversation_id, role, content, created_at

---

## Session Escrow + Kamino Finance (COMPLETE)

Real-time second-precision escrow with Kamino yield on idle USDC.

**Escrow flow:**
1. **Check-in**: `original_amount = hourly_rate × planned_hours` USDC → treasury (escrow keeper) → Kamino deposit
2. **Real-time**: Second counter ticks; `current_cost = hourly_rate × elapsed_seconds / 3600`
3. **Check-out**: Kamino withdrawal (principal + yield) → split:
   - `time_cost × 0.85` → host payment
   - `time_cost × 0.15` → treasury
   - `original_amount - time_cost` → user refund (if ≥ 0.001 USDC)
   - Kamino yield → **treasury only** (0% to host or user)

**Files:**
- `artifacts/jaire-python/app/services/session_service.py` — Session lifecycle (check-in, real-time, check-out)
- `artifacts/jaire-python/app/services/kamino_service.py` — Kamino integration (simulated devnet, mainnet hook)
- `artifacts/jaire-python/app/routers/sessions.py` — Session API routes
- `artifacts/jaire-python/app/schemas/session.py` — Pydantic schemas
- `programs/jaire-escrow/programs/jaire-escrow/src/lib.rs` — Updated Anchor program (second-precision)

**Session API Endpoints:**
- `POST /jaire/session/check-in` — Check in, lock USDC in Kamino
- `GET /jaire/session/:id/status` — Real-time elapsed + cost (call every second)
- `POST /jaire/session/:id/check-out` — Settle: split, refund, harvest yield
- `GET /jaire/session/:id` — Full session record
- `GET /jaire/sessions/user/:identifier` — User's session history

**Kamino:**
- Devnet: 5% APY simulated (configurable via `KAMINO_SIMULATED_APY` env var)
- Mainnet: Hook in `kamino_service.py` `deposit_to_kamino()` / `withdraw_from_kamino()`
  - Program: `KLend2g3cZ87astpptFc4HcnKoGmJ7aSRrBDVH9tVSN`

**Anchor Program changes (v2 — second precision):**
- `per_second_rate_usdc` replaces `hourly_rate_usdc` (rate stored per second in atomic units)
- `planned_seconds: u64` replaces `planned_hours: u8`
- Billing exact to-the-second, no rounding up
- `DUST_THRESHOLD = 1000` atomic units (0.001 USDC) — below this, no refund sent
- Kamino yield settlement is off-chain (treasury sweeps separately)

**DB Table:** `jaire_sessions` — all session fields including Kamino position tracking

---

## Web3Auth MPC Integration (COMPLETE)

Invisible Solana wallets created at social login — user never sees a seed phrase.

**Architecture:**
- MPC Sidecar (`services/mpc-sidecar/`) → Node.js Express on port 9000
- Node factor key (`WEB3AUTH_NODE_FACTOR_KEY`) + HMAC-SHA256 → deterministic 32-byte factor share per user
- Factor share → deterministic devnet Keypair (simulation of TSS multi-party signing)
- JWT verified via Web3Auth JWKS (`https://api-auth.web3auth.io/jwks`)

**MPC Sidecar endpoints (port 9000):**
| Endpoint | Purpose |
|---|---|
| `POST /mpc/factor-share` | Return server factor share to authenticated frontend SDK |
| `POST /mpc/wallet` | Return wallet address for a Web3Auth user |
| `POST /mpc/verify-token` | Verify JWT + return wallet address (called by Python API) |
| `POST /mpc/wallet-balance` | SOL + USDC balance for user's invisible wallet |
| `POST /mpc/fund-wallet` | Transfer USDC from treasury → user wallet (post-payment) |
| `POST /mpc/sign-usdc-transfer` | Co-sign USDC from user wallet → escrow on check-in |

**Python wallet API endpoints:**
| Endpoint | Purpose |
|---|---|
| `POST /jaire/wallet/connect` | Verify JWT, link wallet to user, return address + balance |
| `POST /jaire/wallet/balance` | Get USDC balance for a JWT user |
| `POST /jaire/wallet/fund` | Fund wallet with USDC (devnet/test, called after Paystack) |

**Payment → wallet flow:**
1. User pays NGN via Paystack
2. Paystack webhook → Python API
3. Python API converts NGN → USDC via exchange rate
4. Python API calls `POST /mpc/fund-wallet` (with user's Web3Auth JWT) → USDC transferred from treasury → user's invisible wallet
5. Frontend calls `POST /jaire/session/check-in` with `web3auth_token`
6. Python API calls `POST /mpc/sign-usdc-transfer` → user's wallet signs USDC → escrow

**Check-in with Web3Auth:**
- `POST /jaire/session/check-in` now accepts optional `web3auth_token`
- When provided: verifies JWT → links wallet to user record → signs escrow deposit from user's invisible wallet
- When absent: falls back to treasury-held simulated transfer (test mode)

**Files:**
- `services/mpc-sidecar/src/services/solana-wallet.ts` — USDC balance, fund, sign transfer
- `services/mpc-sidecar/src/routes/mpc.ts` — all 6 MPC endpoints
- `artifacts/jaire-python/app/services/wallet_service.py` — Python → MPC sidecar bridge
- `artifacts/jaire-python/app/routers/wallet_mpc.py` — wallet API routes
- `artifacts/jaire-python/app/config.py` — `treasury_pubkey`, `mpc_sidecar_url` config

**DB changes:** `jaire_wallets` table gained `verifier_id` (VARCHAR) + `wallet_type` (VARCHAR) columns (safe migration on startup)

**Devnet vs Mainnet:**
- Devnet: Server derives full keypair (simulation). No TSS ceremony.
- Mainnet: Replace `signUserUSDCTransfer()` with a proper Web3Auth TSS co-sign call (tKey MPC)

---

## Frontend (COMPLETE)

React + Vite app at `/` (port 24196 in dev). Dark fintech aesthetic — Solana Green accent (#00FFA3), USDC Blue highlight.

**Pages:**
- `/` — Landing: hero + featured workspaces + Baire chat CTA
- `/workspaces` — Browse all 4 workspaces (NGN + USDC rates, availability badges, AI-generated images)
- `/workspaces/:id` — Workspace detail: availability calendar, amenities, book CTA
- `/book/:workspaceId` — Booking flow: duration + payment method (Paystack/USDC wallet)
- `/session/:bookingId` — Multi-state session page: pending (awaiting payment), confirmed (escrowed, scan QR to check in), active (live timer + per-second cost), completed (settlement tx link)
- `/bookings` — Booking history with dates, durations, amounts
- `/baire` — Chat UI with Baire AI concierge (typing indicator, message bubbles)
- `/wallet` — Web3Auth invisible wallet: USDC/SOL balance, fund via Paystack (NGN→USDC)
- `/analytics` — Jaie Analytics host dashboard: revenue chart, occupancy chart, activity feed

**API routes (Express api-server, port 8080):**
- `GET /api/workspaces` — List workspaces (snake_case serialized)
- `GET /api/workspaces/:id` — Workspace detail
- `GET /api/workspaces/:id/availability` — Time slots
- `GET /api/bookings` — User booking list
- `POST /api/bookings` — Create booking / check-in
- `GET /api/bookings/:id` — Booking detail
- `POST /api/bookings/:id/checkout` — Check out (second-precision billing)
- `GET /api/bookings/:id/status` — Live ticking status
- `POST /api/wallet/connect` — Connect MPC wallet
- `GET /api/wallet/balance` — USDC + SOL balance
- `POST /api/wallet/fund` — Fund via Paystack NGN→USDC
- `GET /api/analytics/dashboard` — Host dashboard metrics
- `GET /api/analytics/occupancy` — Occupancy per workspace per day
- `GET /api/analytics/revenue` — Revenue breakdown
- `GET /api/analytics/activity` — Activity event feed

**DB tables (PostgreSQL):** `workspaces`, `bookings`, `activity_events`, `users`, `payments` (plus pre-existing `jaire_*` Python tables)

**Vite proxy config:** `/api` → port 8080, `/jaire` → port 8000, `/mpc` → port 9000

**Codegen:** `lib/api-spec/openapi.yaml` → `pnpm run --filter @workspace/api-spec codegen` → `lib/api-client-react/src/generated/api.ts`

---

## Transaction Pipeline (Phase 3 — Real)

### Booking status state machine
- `pending` — booking created, Paystack payment not yet confirmed
- `confirmed` — Paystack payment received + USDC escrowed (vault locked), awaiting physical scan-in
- `active` — user physically checked in (QR scan), per-second billing running
- `completed` — checked out, 85/15 USDC split settled on-chain

### Payment + escrow flow (Paystack path)
1. User clicks "Book Now" → `POST /api/payments/book-with-balance` → Paystack `initialize_transaction` → returns access_code + authorization_url
2. Frontend opens Paystack popup (inline JS) → user pays NGN
3. `onSuccess` callback → polls `GET /api/payments/status/{reference}` every 5s
4. Paystack fires `charge.success` webhook OR status endpoint verifies directly
5. `processSuccessfulPayment()` runs: treasury → user wallet (fund), then user wallet → vault (escrow)
6. Booking → `confirmed`. Booking holds `escrow_tx_signature`.
7. User physically arrives → scans QR code → `POST /api/qr/checkin` → existing `confirmed` booking promoted to `active` (checkInTime set NOW — billing starts)
8. User scans out → `POST /api/qr/checkout` → per-second billing calculated → vault refunds excess USDC → booking `completed` with `settlement_tx_signature`

### Wallet payment flow (direct USDC)
1. `book-with-balance` checks wallet balance via MPC sidecar
2. If balance ≥ escrow AND `verifierId` in DB → calls `/mpc/internal/escrow` directly
3. Booking → `confirmed`, `escrow_tx_signature` stored; timer starts only after QR scan-in

### AI (Baire)
- Model: OpenAI GPT-4o (switched from Groq llama-3.3-70b)
- Non-streaming invoke → word-by-word yield (avoids Groq streaming + tool call format bug)

### Paystack webhook setup (required for production)
- Set webhook URL in Paystack dashboard to: `{APP_URL}/api/payments/webhook`
- In dev: status polling (`GET /api/payments/status/{reference}`) verifies with Paystack directly as fallback
- Webhook HMAC key: `PAYSTACK_TEST_API_KEY` (same key used for API calls)

### FX model (hidden from user)
- Market rate: 1600 NGN/USDC
- JaIre rate: 1608 NGN/USDC (+0.5% spread)
- Revenue: JaIre retains 0.5% of every NGN→USDC conversion

### MPC sidecar endpoints
- `POST /mpc/wallet` — derive wallet address from JWT
- `POST /mpc/wallet-balance` — SOL + USDC balance (requires JWT)
- `GET /mpc/balance/:address` — balance without JWT (server-to-server)
- `POST /mpc/fund-wallet` — treasury → user wallet (requires JWT)
- `POST /mpc/fund-by-address` — treasury → wallet address (server-to-server, no JWT)
- `POST /mpc/sign-usdc-transfer` — co-sign user USDC transfer (requires JWT)

---

## Admin Dashboard (COMPLETE)

Route: `/admin` — self-contained login gate (no auth provider needed), stores key in `localStorage`.

**API endpoints** (`artifacts/api-server/src/routes/admin.ts`), all require `Authorization: Bearer <JAIRE_ADMIN_TOKEN>`:
| Endpoint | Purpose |
|---|---|
| `GET /api/admin/overview` | Platform totals + vault balance (live Solana RPC) |
| `GET /api/admin/organizations` | All orgs + KYC status + pending count |
| `GET /api/admin/bookings` | All bookings with org + workspace details |
| `GET /api/admin/activity` | Recent activity events (limit 50) |
| `PATCH /api/admin/kyc/:orgId` | Approve or reject org KYC (`{ action: "approve"|"reject" }`) |

**Frontend** (`artifacts/jaire-app/src/pages/admin.tsx`): 4 tabs — Overview, Orgs, Bookings, Blink URL copier.

## Solana Blinks / Actions (COMPLETE)

Spec-compliant Solana Actions at `artifacts/api-server/src/routes/actions.ts`.

| Endpoint | Purpose |
|---|---|
| `GET /api/actions/actions.json` | Dialect manifest for blink crawlers |
| `GET /api/actions/workspace/:id` | Blink metadata for a specific workspace |
| `POST /api/actions/workspace/:id` | Returns serialized unsigned USDC-transfer tx |
| `GET /api/actions/checkin` | Multi-workspace checkin blink (all active workspaces) |
| `POST /api/actions/checkin` | Returns signed checkin tx for selected workspace |

Share links via `https://dial.to/?action=solana-action:<JAIRE_PUBLIC_URL>/api/actions/workspace/<id>` for one-tap coworking bookings from Twitter/X or any Blinks-compatible wallet.

## Next Steps

- [ ] Set `JAIRE_ADMIN_TOKEN` secret for production admin access
- [ ] Roqqu direct integration (requires published website URL)
- [ ] IoT smart plug access control
- [ ] Kamino mainnet integration (klend-sdk)
- [ ] Web3Auth frontend SDK integration (tKey MPC Core Kit)
- [ ] Baire voice-to-voice (WebRTC audio)
- [ ] Paystack webhook registration in Paystack dashboard (set webhook URL to /api/payments/webhook)
