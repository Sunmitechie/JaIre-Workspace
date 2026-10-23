#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ ! -f .env ]]; then
  cp .env.example .env
  printf 'Created .env from .env.example; update placeholders only if you need real integrations.\n'
fi

corepack enable
pnpm install
uv sync
docker compose -f docker-compose.test.yml up --build --detach

printf 'Smoke stack started. Run bash scripts/smoke.sh to verify it, then docker compose -f docker-compose.test.yml down to stop it.\n'