#!/usr/bin/env bash
# tractor-start.sh — start the tractor daemon with pi-agent, auto-loading .refarm/.env
#
# Usage:
#   ./scripts/tractor-start.sh                          # foreground (default)
#   ./scripts/tractor-start.sh --background             # background with PID file
#   ./scripts/tractor-start.sh --namespace myproject    # custom namespace
#   MODEL_PROVIDER=openai ./scripts/tractor-start.sh      # override provider
#
# Keys are loaded from .refarm/.env (gitignored).
# Run `refarm sow` to configure them.
# Run `<package-manager> run agent:stop` to stop a backgrounded daemon.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_MANAGER_HELPER="$ROOT/scripts/package-manager.sh"
MODEL_PROVIDER_HELPER="$ROOT/scripts/model-provider.sh"
ENV_FILE="$ROOT/.refarm/.env"
PID_FILE="$ROOT/.refarm/tractor.pid"
LOG_FILE="$ROOT/.refarm/tractor.log"

# ── resolve CARGO_TARGET_DIR: env → .cargo/config.toml → workspace fallback ──

resolve_cargo_target() {
  if [ -n "${CARGO_TARGET_DIR:-}" ]; then
    printf "%s" "$CARGO_TARGET_DIR"
    return
  fi
  local config="$ROOT/.cargo/config.toml"
  if [ -f "$config" ]; then
    local from_config
    from_config="$(grep -m1 '^\s*target-dir\s*=' "$config" | sed 's/.*=\s*"\(.*\)"/\1/')"
    if [ -n "$from_config" ]; then
      printf "%s" "$from_config"
      return
    fi
  fi
  printf "%s" "$ROOT/packages/tractor/target"
}

_CARGO_TARGET="$(resolve_cargo_target)"
TRACTOR="$_CARGO_TARGET/release/tractor"
PI_AGENT="$_CARGO_TARGET/wasm32-wasip1/release/pi_agent.wasm"
INSTALLED_PI_AGENT="$HOME/.refarm/plugins/@refarm/pi-agent/plugin.wasm"
REFARM_CLI="$ROOT/apps/refarm/dist/index.js"
REFARM_STREAMS_DIR="${REFARM_STREAMS_DIR:-$HOME/.refarm/streams}"
REFARM_HTTP_HOST="${REFARM_HTTP_HOST:-}"

if [ -z "$REFARM_HTTP_HOST" ]; then
  if [ -f "/.dockerenv" ]; then
    REFARM_HTTP_HOST="0.0.0.0"
  else
    REFARM_HTTP_HOST="127.0.0.1"
  fi
fi

if [ ! -f "$PACKAGE_MANAGER_HELPER" ]; then
  echo "❌  package manager helper not found: $PACKAGE_MANAGER_HELPER"
  exit 1
fi

# shellcheck disable=SC1090
source "$PACKAGE_MANAGER_HELPER"

if [ ! -f "$MODEL_PROVIDER_HELPER" ]; then
  echo "❌  model provider helper not found: $MODEL_PROVIDER_HELPER"
  exit 1
fi

# shellcheck disable=SC1090
source "$MODEL_PROVIDER_HELPER"

PACKAGE_MANAGER="$(resolve_package_manager "$ROOT")"

script_command() {
  local script="$1"
  script_command_for_package_manager "$PACKAGE_MANAGER" "$script"
}

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
    | { grep ":${1}" || true; } \
    | { grep -o 'pid=[0-9]*' || true; } \
    | cut -d= -f2 \
    | head -1
}

_existing="$(_port_pid 42000)"
if [ -n "$_existing" ]; then
  echo "❌  Port 42000 is already bound by PID $_existing."
  echo "   If farmhand is running: $(script_command farmhand:stop)"
  echo "   If another tractor is running: $(script_command agent:stop)"
  echo "   See: docs/PROCESS_PLAYBOOK.md"
  exit 1
fi

# ── preflight checks ──────────────────────────────────────────────────────────

if [ ! -f "$TRACTOR" ]; then
  echo "❌  tractor binary not found at $TRACTOR"
  echo "   Build it first: cargo build --manifest-path packages/tractor/Cargo.toml --release"
  exit 1
fi

if [ ! -f "$PI_AGENT" ]; then
  echo "❌  pi_agent.wasm not found at $PI_AGENT"
  echo "   Build it first: cargo component build --manifest-path packages/pi-agent/Cargo.toml --release"
  exit 1
fi

if [ -f "$REFARM_CLI" ]; then
  node "$REFARM_CLI" plugin update --json >/dev/null 2>&1 || true
fi

if [ -f "$INSTALLED_PI_AGENT" ]; then
  PI_AGENT="$INSTALLED_PI_AGENT"
fi

# ── load .refarm/.env ─────────────────────────────────────────────────────────

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "⚠   No .refarm/.env found. LLM calls may fail without API keys."
  echo "   Run: refarm sow"
fi

# ── provider selection ────────────────────────────────────────────────────────

if [ -z "${MODEL_PROVIDER:-}" ]; then
  MODEL_PROVIDER="$(resolve_refarm_model_provider "$ROOT")"
  export MODEL_PROVIDER
fi

if [ -f "$REFARM_CLI" ]; then
  _model_env_exports="$(node "$REFARM_CLI" model env --shell 2>/dev/null || true)"
  if [ -n "$_model_env_exports" ]; then
    eval "$_model_env_exports"
  fi
fi

# ── key check ─────────────────────────────────────────────────────────────────

require_key() {
  local var="$1"
  if [ -z "${!var:-}" ]; then
    echo "  MODEL_PROVIDER=$MODEL_PROVIDER but $var is not set."
    echo "   Configure keys with: refarm sow"
    exit 1
  fi
}

case "$MODEL_PROVIDER" in
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
    echo "   MODEL_PROVIDER=ollama (sovereign default — no API key needed)"
    echo "   Ensure Ollama is running: ollama serve"
    ;;
esac

# ── start daemon ──────────────────────────────────────────────────────────────

HAS_HTTP_HOST=0
for arg in "$@"; do
  case "$arg" in
    --http-host|--http-host=*) HAS_HTTP_HOST=1 ;;
  esac
done

TRACTOR_ARGS=(--plugin "$PI_AGENT")
if [ "$HAS_HTTP_HOST" = "0" ]; then
  TRACTOR_ARGS+=(--http-host "$REFARM_HTTP_HOST")
fi
TRACTOR_ARGS+=("$@")

echo "   Starting tractor daemon"
echo "   provider : $MODEL_PROVIDER"
echo "   plugin   : $PI_AGENT"
echo "   streams  : $REFARM_STREAMS_DIR"
echo "   http bind: $REFARM_HTTP_HOST:42001"
[ $# -gt 0 ] && echo "   extra    : $*"

mkdir -p "$(dirname "$PID_FILE")" "$REFARM_STREAMS_DIR"
export REFARM_STREAMS_DIR

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
  nohup "$TRACTOR" "${TRACTOR_ARGS[@]}" > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "   Started  : pid $(cat "$PID_FILE")"
  echo ""
  echo "   Check status : $(script_command agent:status)"
  echo "   Stop daemon  : $(script_command agent:stop)"
  echo "   Follow log   : tail -f $LOG_FILE"
else
  echo ""
  exec "$TRACTOR" "${TRACTOR_ARGS[@]}"
fi
