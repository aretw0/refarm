#!/usr/bin/env bash
# tractor-start.sh — start the tractor daemon with agent, auto-loading .refarm/.env
#
# Usage:
#   ./scripts/tractor-start.sh                          # foreground (default)
#   ./scripts/tractor-start.sh --background             # background with PID file
#   ./scripts/tractor-start.sh --namespace myproject    # custom namespace
#   MODEL_PROVIDER=openai ./scripts/tractor-start.sh      # override provider
#
# Bind hosts (see the "bind hosts" block below for the full reasoning):
#   REFARM_HTTP_HOST   sidecar bind. Left UNSET unless the operator (or .refarm/.env)
#                      names one explicitly — this script never invents a value or
#                      writes to .refarm/config.json. Unset means "let the declaration
#                      decide" (packages/tractor's `--http-host` is `Option<String>`,
#                      no default): undeclared or `"loopback"` ⇒ 127.0.0.1; a
#                      `surfaces.sidecar-http` declaring `"host:<ip>"` (see
#                      docs/container-surfaces.example.json) ⇒ that host, once its
#                      gate is actually configured (S3). A container gets loud
#                      guidance instead of automation — see the "bind hosts" block.
#   REFARM_WS_HOST     CRDT/agent WS bind. Default 127.0.0.1, and the daemon refuses
#                      anything else regardless of policy until ADR-093 lands (S3:
#                      `surfaces.daemon-ws` may declare only "loopback").
#   REFARM_AUTH_POLICY the per-device credential policy. The same file the daemon
#                      reads; its presence is what unlocks a wider sidecar bind, once
#                      `surfaces.sidecar-http` also names it.
#
# Keys are loaded from .refarm/.env (gitignored).
# Run `refarm sow` to configure them.
# Run `refarm runtime stop` to stop a backgrounded daemon.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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
      # cargo anchors a relative target-dir to the config's directory, not the cwd
      case "$from_config" in
        /*) printf "%s" "$from_config" ;;
        *) printf "%s" "$ROOT/$from_config" ;;
      esac
      return
    fi
  fi
  printf "%s" "$ROOT/.cache/cargo-target"
}

_CARGO_TARGET="$(resolve_cargo_target)"
TRACTOR="$_CARGO_TARGET/release/tractor"
AGENT_PLUGIN="$_CARGO_TARGET/wasm32-wasip1/release/agent.wasm"
REFARM_CLI="$ROOT/apps/refarm/dist/index.js"
REFARM_HOME="${REFARM_HOME:-$ROOT/.refarm}"
XDG_DATA_HOME="${XDG_DATA_HOME:-$REFARM_HOME/data}"
REFARM_STREAMS_DIR="${REFARM_STREAMS_DIR:-$REFARM_HOME/streams}"
INSTALLED_AGENT_PLUGIN="$REFARM_HOME/plugins/@refarm/agent/plugin.wasm"

# Bind hosts are resolved LATER (after .refarm/.env is sourced), because the decision
# depends on REFARM_AUTH_POLICY and that may be set in the env file. Only the operator's
# explicit process-env values are captured here.
REFARM_HTTP_HOST="${REFARM_HTTP_HOST:-}"
REFARM_WS_HOST="${REFARM_WS_HOST:-}"

if [ ! -f "$MODEL_PROVIDER_HELPER" ]; then
  echo "❌  model provider helper not found: $MODEL_PROVIDER_HELPER"
  exit 1
fi

# shellcheck disable=SC1090
source "$MODEL_PROVIDER_HELPER"

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
  echo "   If another runtime is running: refarm runtime stop"
  echo "   See: docs/PROCESS_PLAYBOOK.md"
  exit 1
fi

# ── preflight checks ──────────────────────────────────────────────────────────

if [ ! -f "$TRACTOR" ]; then
  echo "❌  tractor binary not found at $TRACTOR"
  echo "   Build it first: cargo build --manifest-path packages/tractor/Cargo.toml --release"
  exit 1
fi

if [ -f "$REFARM_CLI" ]; then
  node "$REFARM_CLI" plugin update --json >/dev/null 2>&1 || true
fi

# Prefer the INSTALLED agent (in $REFARM_HOME/plugins) over the raw compiled artifact —
# but only if it is not STALE. A freshly-compiled agent (e.g. after a WIT rename) whose
# import names moved will not match the daemon's linker, and the daemon would load the old
# installed copy and fail (`component imports instance ... not found in the linker`). So if
# the compiled build is newer than the installed copy, reinstall it first. This is the
# dist-stale guard: source (the compiled wasm) is truth; the install is a derived snapshot.
if [ -f "$INSTALLED_AGENT_PLUGIN" ]; then
  if [ -f "$AGENT_PLUGIN" ] && [ "$AGENT_PLUGIN" -nt "$INSTALLED_AGENT_PLUGIN" ]; then
    echo "   ↻ Installed agent is older than the compiled build — reinstalling…"
    if [ -f "$REFARM_CLI" ]; then
      REFARM_HOME="$REFARM_HOME" CARGO_TARGET_DIR="$_CARGO_TARGET" \
        node "$ROOT/scripts/agent-install.mjs" >/dev/null 2>&1 || true
    fi
  fi
  # Use the installed copy if it (still) exists after the optional reinstall.
  [ -f "$INSTALLED_AGENT_PLUGIN" ] && AGENT_PLUGIN="$INSTALLED_AGENT_PLUGIN"
fi

if [ ! -f "$AGENT_PLUGIN" ]; then
  echo "❌  agent plugin wasm not found at $AGENT_PLUGIN"
  echo "   Install it with: refarm plugin update"
  echo "   Build it first: cargo component build --manifest-path packages/agent/Cargo.toml --release"
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
  echo "   Run: refarm sow"
fi

# ── provider selection ────────────────────────────────────────────────────────

if [ -z "${MODEL_PROVIDER:-}" ]; then
  MODEL_PROVIDER="$(resolve_refarm_model_provider "$ROOT")"
  export MODEL_PROVIDER
fi

if [ -f "$REFARM_CLI" ]; then
  _model_env_exports="$(node "$REFARM_CLI" model env --shell --include-secrets 2>/dev/null || true)"
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
  openai-codex) require_key OPENAI_CODEX_ACCESS_TOKEN ;;
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

# ── bind hosts ────────────────────────────────────────────────────────────────
#
# This block used to set REFARM_HTTP_HOST=0.0.0.0 whenever /.dockerenv existed, then
# (after S1 made an undeclared surface bind loopback regardless of any flag) it went
# further and WROTE `surfaces.sidecar-http` into .refarm/config.json itself with `jq`,
# so a container would still widen automatically. That inverted the doctrine the whole
# `surfaces` design rests on: the declaration is the OPERATOR's statement of intent,
# interpreted by the runtime — if a launch script synthesises it, what the machine
# declares becomes a function of how it was launched (and of whether `jq` happened to be
# installed), which is precisely the disease `surfaces` exists to cure. This script does
# not read or write .refarm/config.json anymore, anywhere in this file, and needs no
# `jq` dependency for this path.
#
# A container is a DEPLOYMENT, and a deployment declares its surfaces like any other
# machine — the declaration travels WITH the container (baked into the image or bind-
# mounted at .refarm/config.json) rather than being invented at boot. See
# docs/container-surfaces.example.json for the declaration to copy in, and the
# `tractor::sidecar::bind_guard` doc comment for the full S1/S3/S5 reasoning.
#
# Since packages/tractor/src/main.rs's `--http-host` is now `Option<String>` (no
# `default_value`), passing NOTHING lets `surfaces.sidecar-http` decide — undeclared or
# `"loopback"` ⇒ loopback, a `"host:<ip>"` declaration ⇒ that host, once its gate is
# actually configured. So:
#
#   operator set REFARM_HTTP_HOST (env or .refarm/.env)  ⇒ pass it through verbatim —
#                                                             their explicit choice; the
#                                                             daemon's guard narrows or
#                                                             refuses it against whatever
#                                                             IS declared, exactly as any
#                                                             --http-host flag always has
#   operator did not set it                                ⇒ pass nothing; the daemon
#                                                             resolves it from the
#                                                             declaration
#
# An operator who exports REFARM_HTTP_HOST=0.0.0.0 by hand still gets exactly what they
# asked for: the daemon's guard refuses it and names the fix (the exact `surfaces` JSON
# to add) if nothing declares it. That refusal is honest — an explicit request answered
# with an explicit reason — and it is not this script's job to route around it.

_auth_policy_configured() {
  [ -n "${REFARM_AUTH_POLICY:-}" ] && [ -f "${REFARM_AUTH_POLICY}" ]
}

CONFIG_JSON="$ROOT/.refarm/config.json"

IN_CONTAINER=0
if [ -f "/.dockerenv" ]; then
  IN_CONTAINER=1
fi

# The WS (:42000) is stricter than the sidecar: the daemon refuses ANY non-loopback bind
# there regardless of policy, because that socket has no credential gate at all (no
# middleware reads the policy) and accepts `user:prompt` from whoever reaches it. Until
# ADR-093's WS credential handshake ships there is no value of REFARM_WS_HOST other than
# loopback that the daemon will accept — so the script passes loopback explicitly instead
# of leaving the bind to whatever the default happens to be that week.
if [ -z "$REFARM_WS_HOST" ]; then
  REFARM_WS_HOST="127.0.0.1"
fi

if [ "$IN_CONTAINER" = "1" ]; then
  if [ -z "$REFARM_HTTP_HOST" ]; then
    echo "⚠   Container detected, REFARM_HTTP_HOST not set — the sidecar binds whatever"
    echo "    surfaces.sidecar-http declares in $CONFIG_JSON (undeclared ⇒ 127.0.0.1)."
    echo "    A published '-p 42001:42001' will NOT reach an undeclared/loopback sidecar."
    echo "    This is deliberate: the daemon refuses an unauthenticated, undeclared"
    echo "    listener other devices can reach. To publish it, declare the surface —"
    echo "    docs/container-surfaces.example.json is a copy-pasteable example:"
    echo "      \"surfaces\": { \"sidecar-http\": { \"expose\": \"host:0.0.0.0\", \"gate\": \"device-token\" } }"
    if ! _auth_policy_configured; then
      echo "    then mint a per-device credential and point the daemon at it:"
      echo "      refarm auth enroll"
      echo "      export REFARM_AUTH_POLICY=<the resulting policy file>"
    fi
  fi
  echo "⚠   The CRDT/agent WebSocket stays on 127.0.0.1 — '-p 42000:42000' will NOT"
  echo "    reach it, policy or not. That socket has no credential gate yet (ADR-093);"
  echo "    reach it through an authenticated front, not by publishing the port."
fi

# ── start daemon ──────────────────────────────────────────────────────────────

HAS_HTTP_HOST=0
HAS_WS_HOST=0
for arg in "$@"; do
  case "$arg" in
    --http-host|--http-host=*) HAS_HTTP_HOST=1 ;;
    --ws-host|--ws-host=*) HAS_WS_HOST=1 ;;
  esac
done

TRACTOR_ARGS=(--plugin "$AGENT_PLUGIN")

# Boot the COMPOSITION, not just the agent: load every INSTALLED plugin whose
# runtime id is trusted (`trusted_plugins` in config.json), minus the agent (loaded
# above). The resolver owns the JSON parse + trust/dedup rules (and stays silent on
# error, so a hiccup never blocks the agent-only boot). This is the orchestrator step
# ADR-059 assigns to the CLI: the Rust host stays imperative `--plugin`; discovery +
# translation happen here. Requires the built CLI (present after `plugin update`).
TRUSTED_PLUGINS=()
if [ -f "$REFARM_CLI" ]; then
  while IFS= read -r _p; do
    [ -n "$_p" ] && TRUSTED_PLUGINS+=("$_p")
  done < <(node "$ROOT/scripts/resolve-boot-plugins.mjs" "$REFARM_HOME" 2>/dev/null)
fi
for _p in ${TRUSTED_PLUGINS[@]+"${TRUSTED_PLUGINS[@]}"}; do
  TRACTOR_ARGS+=(--plugin "$_p")
done

# Only pass --http-host when the operator explicitly set REFARM_HTTP_HOST (env or
# .refarm/.env) — tractor's `--http-host` is `Option<String>` now, and passing NOTHING
# is how the operator lets `surfaces.sidecar-http` decide (Problem 1's fix). Passing an
# empty string here would be an explicit (and wrong) request for "" as a hostname, not
# the same as omitting the flag — so this is a real branch, not a style choice.
if [ "$HAS_HTTP_HOST" = "0" ] && [ -n "$REFARM_HTTP_HOST" ]; then
  TRACTOR_ARGS+=(--http-host "$REFARM_HTTP_HOST")
fi
# Pass --ws-host explicitly for the same reason --http-host was historically passed
# explicitly: the bind this script chose should be visible in the process args, not
# inferred from a default. Unlike --http-host, REFARM_WS_HOST is ALWAYS resolved above
# (loopback if unset) because no declaration can ever change what the WS accepts.
if [ "$HAS_WS_HOST" = "0" ]; then
  TRACTOR_ARGS+=(--ws-host "$REFARM_WS_HOST")
fi
TRACTOR_ARGS+=(--refarm-dir "$REFARM_HOME")
TRACTOR_ARGS+=("$@")

echo "   Starting tractor daemon"
echo "   provider : $MODEL_PROVIDER"
echo "   plugin   : $AGENT_PLUGIN"
[ ${#TRUSTED_PLUGINS[@]} -gt 0 ] && echo "   +trusted : ${#TRUSTED_PLUGINS[@]} plugin(s) from composition"
echo "   streams  : $REFARM_STREAMS_DIR"
echo "   http bind: ${REFARM_HTTP_HOST:-<unset — surfaces.sidecar-http decides>}:42001"
echo "   ws bind  : $REFARM_WS_HOST:42000"
[ $# -gt 0 ] && echo "   extra    : $*"

mkdir -p "$(dirname "$PID_FILE")" "$REFARM_HOME" "$REFARM_STREAMS_DIR" "$XDG_DATA_HOME"
export REFARM_HOME
export REFARM_STREAMS_DIR
export XDG_DATA_HOME

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
  echo "   Check status : refarm runtime"
  echo "   Stop runtime : refarm runtime stop"
  echo "   Follow log   : tail -f $LOG_FILE"
else
  echo ""
  exec "$TRACTOR" "${TRACTOR_ARGS[@]}"
fi
