# JaIre Workspace

JaIre is a Web2.5 coworking platform monorepo that combines a React frontend, a FastAPI Python service, an Express API server, an MPC sidecar, and a Solana Anchor program.

## Stack

- Frontend: React + Vite + TypeScript
- API gateway: Express + TypeScript
- Core backend: FastAPI + Python 3.11 + uvicorn
- MPC / wallet service: TypeScript sidecar
- Blockchain: Solana + Anchor
- Package manager: pnpm
- Python dependency manager: uv

## Repository layout

- `artifacts/jaire-app/` — main Vite React app
- `artifacts/api-server/` — Express API gateway / proxy
- `artifacts/jaire-python/` — FastAPI backend
- `services/mpc-sidecar/` — Web3Auth MPC sidecar
- `programs/jaire-escrow/` — Anchor smart contract
- `lib/` — shared libraries and generated clients
- `scripts/` — migration and utility scripts

## Requirements

- Node.js 20+ (24 recommended)
- pnpm
- Python 3.11+
- uv
- PostgreSQL running locally or in your cloud provider
- A Solana devnet RPC endpoint

## 1) Clone the repo

```bash
git clone <your-repository-url>
cd JaIre-Workspace
```

## 2) Install dependencies

Use pnpm for the monorepo and uv for the Python service:

```bash
corepack enable
pnpm install
uv sync
```

If `uv` is not installed yet:

```bash
pip install uv
```

## 3) Configure environment variables

The project reads values from the root `.env` file. Fill in the placeholders before starting the app.

```bash
# Edit .env at the repo root
```

The root `.env` file is already set up with placeholder values for local development. Replace the sample values with your real local credentials and secrets only on your machine.

## 4) Start the services

Open separate terminals for each service.

### Terminal 1 — Python API

```powershell
cd artifacts/jaire-python
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Terminal 2 — MPC sidecar

```powershell
cd services/mpc-sidecar
pnpm dev
```

### Terminal 3 — Express API gateway

```powershell
cd artifacts/api-server
$env:PORT = "8080"
pnpm dev
```

### Terminal 4 — Frontend app

```powershell
cd artifacts/jaire-app
$env:PORT = "5173"
$env:BASE_PATH = "/"
pnpm dev
```

Then open:

- App: http://localhost:5173
- Python API docs: http://localhost:8000/jaire/docs
- API gateway: http://localhost:8080

## Local routing overview

The frontend proxies requests like this:

- `/api/*` → `http://localhost:8080`
- `/jaire/*` → `http://localhost:8000`
- `/mpc/*` → `http://localhost:9000`

## Useful commands

```bash
# Root workspace checks
pnpm run typecheck

# Build everything
pnpm run build

# Python API startup
cd artifacts/jaire-python
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Notes

- Never commit real credentials to git.
- Keep `.env` local to your machine.
- If you use Windows PowerShell, use `$env:VAR_NAME = "value"` for environment variables.
- For production, use a secure secret manager instead of a local `.env` file.

## Troubleshooting

- If the frontend cannot reach the backend, verify that the Python API and Express API are both running.
- If Solana calls fail, confirm your `SOLANA_RPC_URL` and devnet wallet keys are valid.
- If Web3Auth fails, ensure `WEB3AUTH_CLIENT_ID` and `WEB3AUTH_NODE_FACTOR_KEY` are populated.
- If数据库 errors occur, confirm `DATABASE_URL` points to a reachable Postgres instance.

## License

This project is for internal workspace development unless otherwise specified by the repository owner.
