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
# Stop: npm run farmhand:stop
# Status: npm run farm:status

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FARMHAND_ENTRY="$ROOT/apps/farmhand/src/index.ts"
ENV_FILE="$ROOT/.refarm/.env"
PID_FILE="$ROOT/.refarm/farmhand.pid"
LOG_FILE="$ROOT/.refarm/farmhand.log"
WS_PORT=42000
HTTP_PORT=42001

# ── flags ─────────────────────────────────────────────────────────────────────

BACKGROUND=0
for arg in "$@"; do
  [ "$arg" = "--background" ] && BACKGROUND=1
done

# ── port pre-check ────────────────────────────────────────────────────────────

check_port_pid() {
  local port="$1"
  ss -tlnp 2>/dev/null \
    | awk -v p=":${port}" '
        $0 ~ p {
          match($0, /pid=([0-9]+)/, m)
          if (m[1]) print m[1]
        }
      ' | head -1
}

WS_PID="$(check_port_pid $WS_PORT)"
if [ -n "$WS_PID" ]; then
  echo "❌  Port $WS_PORT is already bound by PID $WS_PID."
  echo "   If tractor is running: npm run agent:stop"
  echo "   If farmhand is running: npm run farmhand:stop"
  echo "   See: docs/PROCESS_PLAYBOOK.md"
  exit 1
fi

HTTP_PID="$(check_port_pid $HTTP_PORT)"
if [ -n "$HTTP_PID" ]; then
  echo "❌  Port $HTTP_PORT is already bound by PID $HTTP_PID."
  echo "   Another farmhand or CI stub may be running."
  echo "   Stop it first, or check: npm run farm:status"
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

# ── load .refarm/.env ─────────────────────────────────────────────────────────

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "⚠   No .refarm/.env found. See: npm run agent:keys"
fi

# ── preflight ─────────────────────────────────────────────────────────────────

if [ ! -f "$FARMHAND_ENTRY" ]; then
  echo "❌  farmhand entry not found: $FARMHAND_ENTRY"
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

if [ "$BACKGROUND" = "1" ]; then
  nohup node --experimental-strip-types "$FARMHAND_ENTRY" > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "   pid      : $(cat "$PID_FILE")"
  echo "   log      : $LOG_FILE"
  echo ""
  echo "   Status  : npm run farm:status"
  echo "   Stop    : npm run farmhand:stop"
else
  exec node --experimental-strip-types "$FARMHAND_ENTRY"
fi
