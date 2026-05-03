#!/usr/bin/env bash
# tractor-start.sh — start the tractor daemon with pi-agent, auto-loading .refarm/.env
#
# Usage:
#   ./scripts/tractor-start.sh                          # foreground (default)
#   ./scripts/tractor-start.sh --background             # background with PID file
#   ./scripts/tractor-start.sh --namespace myproject    # custom namespace
#   LLM_PROVIDER=openai ./scripts/tractor-start.sh      # override provider
#
# Keys are loaded from .refarm/.env (gitignored).
# Run `npm run agent:keys` to configure them.
# Run `npm run agent:stop` to stop a backgrounded daemon.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.refarm/.env"
_CARGO_TARGET="${CARGO_TARGET_DIR:-}"
TRACTOR="${_CARGO_TARGET:+$_CARGO_TARGET/release/tractor}"
TRACTOR="${TRACTOR:-$ROOT/packages/tractor/target/release/tractor}"
PI_AGENT="${_CARGO_TARGET:+$_CARGO_TARGET/wasm32-wasip1/release/pi_agent.wasm}"
PI_AGENT="${PI_AGENT:-$ROOT/packages/pi-agent/target/wasm32-wasip1/release/pi_agent.wasm}"
PID_FILE="$ROOT/.refarm/tractor.pid"
LOG_FILE="$ROOT/.refarm/tractor.log"

# ── parse --background flag (strip before forwarding to tractor) ──────────────

BACKGROUND=0
FORWARDED_ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--background" ]; then
    BACKGROUND=1
  else
    FORWARDED_ARGS+=("$arg")
  fi
done
set -- "${FORWARDED_ARGS[@]+"${FORWARDED_ARGS[@]}"}"

# ── port pre-check ────────────────────────────────────────────────────────────

_port_pid() {
  ss -tlnp 2>/dev/null \
    | awk -v p=":${1}" '
        $0 ~ p {
          match($0, /pid=([0-9]+)/, m)
          if (m[1]) print m[1]
        }
      ' | head -1
}

_existing="$(_port_pid 42000)"
if [ -n "$_existing" ]; then
  echo "❌  Port 42000 is already bound by PID $_existing."
  echo "   If farmhand is running: npm run farmhand:stop"
  echo "   If another tractor is running: npm run agent:stop"
  echo "   See: docs/PROCESS_PLAYBOOK.md"
  exit 1
fi

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

require_key() {
  local var="$1"
  if [ -z "${!var:-}" ]; then
    echo "  LLM_PROVIDER=$LLM_PROVIDER but $var is not set."
    echo "   Run: npm run agent:keys"
    exit 1
  fi
}

case "$LLM_PROVIDER" in
  anthropic)   require_key ANTHROPIC_API_KEY ;;
  openai*)     require_key OPENAI_API_KEY ;;
  groq)        require_key GROQ_API_KEY ;;
  mistral)     require_key MISTRAL_API_KEY ;;
  xai)         require_key XAI_API_KEY ;;
  deepseek)    require_key DEEPSEEK_API_KEY ;;
  together)    require_key TOGETHER_API_KEY ;;
  openrouter)  require_key OPENROUTER_API_KEY ;;
  gemini)      require_key GEMINI_API_KEY ;;
  ollama)
    echo "   LLM_PROVIDER=ollama (sovereign default — no API key needed)"
    echo "   Ensure Ollama is running: ollama serve"
    ;;
esac

# ── start daemon ──────────────────────────────────────────────────────────────

echo "   Starting tractor daemon"
echo "   provider : $LLM_PROVIDER"
echo "   plugin   : $PI_AGENT"
[ $# -gt 0 ] && echo "   extra    : $*"

mkdir -p "$(dirname "$PID_FILE")"

if [ "$BACKGROUND" = "1" ]; then
  # Kill any existing daemon from a previous run
  if [ -f "$PID_FILE" ]; then
    OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      echo "   Stopping previous daemon (pid $OLD_PID)..."
      kill "$OLD_PID" 2>/dev/null || true
      sleep 0.5
    fi
    rm -f "$PID_FILE"
  fi

  echo "   Log      : $LOG_FILE"
  nohup "$TRACTOR" --plugin "$PI_AGENT" "$@" > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "   Started  : pid $(cat "$PID_FILE")"
  echo ""
  echo "   Check status : npm run agent:status"
  echo "   Stop daemon  : npm run agent:stop"
  echo "   Follow log   : tail -f $LOG_FILE"
else
  echo ""
  exec "$TRACTOR" --plugin "$PI_AGENT" "$@"
fi
