#!/usr/bin/env bash
# tractor-start.sh — start the tractor daemon with pi-agent, auto-loading .refarm/.env
#
# Usage:
#   ./scripts/tractor-start.sh                          # default namespace + port
#   ./scripts/tractor-start.sh --namespace myproject    # custom namespace
#   LLM_PROVIDER=openai ./scripts/tractor-start.sh      # override provider
#
# Keys are loaded from .refarm/.env (gitignored).
# Run `node scripts/setup-llm-keys.mjs` to configure them.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.refarm/.env"
TRACTOR="$ROOT/packages/tractor/target/release/tractor"
PI_AGENT="$ROOT/packages/pi-agent/target/wasm32-wasip1/release/pi_agent.wasm"

# ── preflight checks ──────────────────────────────────────────────────────────

if [ ! -f "$TRACTOR" ]; then
  echo "❌  tractor binary not found at $TRACTOR"
  echo "   Build it first: cd packages/tractor && cargo build --release"
  exit 1
fi

if [ ! -f "$PI_AGENT" ]; then
  echo "❌  pi_agent.wasm not found at $PI_AGENT"
  echo "   Build it first: cd packages/pi-agent && cargo component build --release"
  exit 1
fi

# ── load .refarm/.env ─────────────────────────────────────────────────────────

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "⚠   No .refarm/.env found. LLM calls may fail without API keys."
  echo "   Run: node scripts/setup-llm-keys.mjs"
fi

# ── provider selection ────────────────────────────────────────────────────────

# Priority: LLM_PROVIDER env > .refarm/config.json provider field > ollama (sovereign default)
if [ -z "${LLM_PROVIDER:-}" ]; then
  CONFIG="$ROOT/.refarm/config.json"
  if [ -f "$CONFIG" ] && command -v node >/dev/null 2>&1; then
    PROVIDER_FROM_CONFIG=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG','utf8'));process.stdout.write(c.provider||'')}catch{}" 2>/dev/null || true)
    if [ -n "$PROVIDER_FROM_CONFIG" ]; then
      export LLM_PROVIDER="$PROVIDER_FROM_CONFIG"
    fi
  fi
  LLM_PROVIDER="${LLM_PROVIDER:-ollama}"
  export LLM_PROVIDER
fi

# ── key check ─────────────────────────────────────────────────────────────────

case "$LLM_PROVIDER" in
  anthropic)
    if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
      echo "❌  LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set."
      echo "   Run: node scripts/setup-llm-keys.mjs"
      exit 1
    fi
    ;;
  openai*)
    if [ -z "${OPENAI_API_KEY:-}" ]; then
      echo "❌  LLM_PROVIDER=$LLM_PROVIDER but OPENAI_API_KEY is not set."
      echo "   Run: node scripts/setup-llm-keys.mjs"
      exit 1
    fi
    ;;
  ollama)
    echo "ℹ   LLM_PROVIDER=ollama (sovereign default — no API key needed)"
    echo "   Ensure Ollama is running: ollama serve"
    ;;
esac

# ── start daemon ──────────────────────────────────────────────────────────────

echo "🚜  Starting tractor daemon"
echo "   provider : $LLM_PROVIDER"
echo "   plugin   : $PI_AGENT"
echo "   args     : $*"
echo ""

exec "$TRACTOR" --plugin "$PI_AGENT" "$@"
