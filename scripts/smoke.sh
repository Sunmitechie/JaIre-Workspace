#!/usr/bin/env bash
set -euo pipefail

python_api_url="${PYTHON_API_URL:-http://127.0.0.1:8000}"
api_gateway_url="${API_GATEWAY_URL:-http://127.0.0.1:8080}"
smoke_retries="${SMOKE_RETRIES:-120}"
smoke_retry_delay="${SMOKE_RETRY_DELAY:-5}"

check_endpoint() {
  local name="$1"
  local url="$2"

  printf 'Checking %s: %s\n' "$name" "$url"
  curl --fail --silent --show-error \
    --retry "$smoke_retries" \
    --retry-connrefused \
    --retry-delay "$smoke_retry_delay" \
    --max-time 5 \
    "$url" >/dev/null
}

check_endpoint "Python OpenAPI docs" "${python_api_url}/jaire/docs"
check_endpoint "Python health" "${python_api_url}/jaire/health"
check_endpoint "Express gateway root" "${api_gateway_url}/"