#!/usr/bin/env bash
# farmhand-start.sh — start the farmhand Node.js task-orchestration daemon.
#
# Usage:
#   ./scripts/farmhand-start.sh                  # foreground (default)
#   ./scripts/farmhand-start.sh --background      # background with PID file
#
# Farmhand binds two ports:
#   :42000  WebSocket CRDT sync (shared with tractor — run only one at a time)
#   :42001  HTTP sidecar (efforts CRUD, SSE streams)
#
# See: docs/PROCESS_PLAYBOOK.md
#
# Stop: <package-manager> run farmhand:stop
# Status: <package-manager> run farm:status

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_MANAGER_HELPER="$ROOT/scripts/package-manager.sh"
FARMHAND_ENTRY="$ROOT/apps/farmhand/src/index.ts"
FARMHAND_LOADER_REGISTER="$ROOT/scripts/farmhand-node-register-loader.mjs"
ENV_FILE="$ROOT/.refarm/.env"
CONFIG_FILE="$ROOT/.refarm/config.json"
IDENTITY_FILE="$ROOT/.refarm/identity.json"
PID_FILE="$ROOT/.refarm/farmhand.pid"
LOG_FILE="$ROOT/.refarm/farmhand.log"
WS_PORT=42000
HTTP_PORT=42001

if [ ! -f "$PACKAGE_MANAGER_HELPER" ]; then
  echo "❌  package manager helper not found: $PACKAGE_MANAGER_HELPER"
  exit 1
fi

# shellcheck disable=SC1090
source "$PACKAGE_MANAGER_HELPER"

PACKAGE_MANAGER="$(resolve_package_manager "$ROOT")"

script_command() {
  local script="$1"
  script_command_for_package_manager "$PACKAGE_MANAGER" "$script"
}

# ── flags ─────────────────────────────────────────────────────────────────────

BACKGROUND=0
for arg in "$@"; do
  [ "$arg" = "--background" ] && BACKGROUND=1
done

# ── port pre-check ────────────────────────────────────────────────────────────

check_port_pid() {
  local port="$1"
  ss -tlnp 2>/dev/null \
    | { grep ":${port}" || true; } \
    | { grep -o 'pid=[0-9]*' || true; } \
    | cut -d= -f2 \
    | head -1
}

WS_PID="$(check_port_pid $WS_PORT)"
if [ -n "$WS_PID" ]; then
  echo "❌  Port $WS_PORT is already bound by PID $WS_PID."
  echo "   If tractor is running: $(script_command agent:stop)"
  echo "   If farmhand is running: $(script_command farmhand:stop)"
  echo "   See: docs/PROCESS_PLAYBOOK.md"
  exit 1
fi

HTTP_PID="$(check_port_pid $HTTP_PORT)"
if [ -n "$HTTP_PID" ]; then
  echo "❌  Port $HTTP_PORT is already bound by PID $HTTP_PID."
  echo "   Another farmhand or CI stub may be running."
  echo "   Stop it first, or check: $(script_command farm:status)"
  exit 1
fi

# ── stop any stale farmhand from a previous background run ────────────────────

if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "   Stopping previous farmhand (pid $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 0.5
  fi
  rm -f "$PID_FILE"
fi

# ── load .refarm/.env (or explain when it is optional) ──────────────────────

detect_provider() {
  if [ -n "${MODEL_PROVIDER:-}" ]; then
    printf "%s" "$MODEL_PROVIDER"
    return 0
  fi
  if [ -n "${MODEL_DEFAULT_PROVIDER:-}" ]; then
    printf "%s" "$MODEL_DEFAULT_PROVIDER"
    return 0
  fi

  if [ -f "$CONFIG_FILE" ] && command -v node >/dev/null 2>&1; then
    node -e "try{const c=JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8'));process.stdout.write(c.provider||c.default_provider||c.modelProvider||c.tokens?.modelProvider||'')}catch{}" 2>/dev/null || true
    return 0
  fi
  if [ -f "$IDENTITY_FILE" ] && command -v node >/dev/null 2>&1; then
    node -e "try{const c=JSON.parse(require('fs').readFileSync('$IDENTITY_FILE','utf8'));process.stdout.write(c.modelProvider||c.tokens?.modelProvider||'')}catch{}" 2>/dev/null || true
    return 0
  fi

  printf "ollama"
}

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  DETECTED_PROVIDER="$(detect_provider)"
  case "$DETECTED_PROVIDER" in
    ollama|local|mock)
      echo "ℹ   No .refarm/.env found (provider=$DETECTED_PROVIDER, API key optional)."
      ;;
    *)
      echo "⚠   No .refarm/.env found (provider=$DETECTED_PROVIDER)."
      echo "   Configure keys if needed: refarm sow"
      ;;
  esac
fi

# ── preflight ─────────────────────────────────────────────────────────────────

if [ ! -f "$FARMHAND_ENTRY" ]; then
  echo "❌  farmhand entry not found: $FARMHAND_ENTRY"
  exit 1
fi

if [ ! -f "$FARMHAND_LOADER_REGISTER" ]; then
  echo "❌  farmhand loader register not found: $FARMHAND_LOADER_REGISTER"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌  node not found in PATH"
  exit 1
fi

mkdir -p "$ROOT/.refarm"

# ── start ─────────────────────────────────────────────────────────────────────

echo "   Starting farmhand"
echo "   ws-crdt  : ws://127.0.0.1:$WS_PORT"
echo "   http     : http://127.0.0.1:$HTTP_PORT"

FARMHAND_NODE_ARGS=(
  --experimental-strip-types
  --experimental-transform-types
  --import "$FARMHAND_LOADER_REGISTER"
  "$FARMHAND_ENTRY"
)

if [ "$BACKGROUND" = "1" ]; then
  nohup node "${FARMHAND_NODE_ARGS[@]}" > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "   pid      : $(cat "$PID_FILE")"
  echo "   log      : $LOG_FILE"
  echo ""
  echo "   Status  : $(script_command farm:status)"
  echo "   Stop    : $(script_command farmhand:stop)"
else
  exec node "${FARMHAND_NODE_ARGS[@]}"
fi
