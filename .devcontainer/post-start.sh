#!/usr/bin/env bash
set -euo pipefail

echo "[refarm-devcontainer] Post-start sanity check..."

ensure_rust() {
  if ! command -v rustup >/dev/null 2>&1; then
    echo "[refarm-devcontainer] rustup not found, skipping rust sanity check"
    return 0
  fi

  if ! rustup show active-toolchain >/dev/null 2>&1; then
    echo "[refarm-devcontainer] Rust toolchain state unhealthy. Reinstalling stable..."
    rustup toolchain install stable --profile minimal
  fi

  if ! RUSTUP_TOOLCHAIN=stable rustc -vV >/dev/null 2>&1; then
    echo "[refarm-devcontainer] Stable alias is broken. Reinstalling stable toolchain..."
    rustup toolchain install stable --profile minimal
  fi

  rustup default stable >/dev/null 2>&1 || true

  for target in x86_64-unknown-linux-gnu wasm32-unknown-unknown wasm32-wasip1; do
    rustup target add "$target" >/dev/null 2>&1 || true
  done
}

ensure_hooks() {
  if [ -d .git ] && [ ! -x .git/hooks/pre-push ]; then
    echo "[refarm-devcontainer] Installing git hooks..."
    npm run hooks:install >/dev/null 2>&1 || true
  fi
}

check_agent_env() {
  local missing=()

  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    missing+=("ANTHROPIC_API_KEY  → pi /login  ou  claude /login")
  fi
  if [ -z "${GH_TOKEN:-}" ] && ! gh auth status >/dev/null 2>&1; then
    missing+=("GH_TOKEN           → gh auth login")
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    echo ""
    echo "[refarm-devcontainer] ℹ️  Agent tools need auth (configure when ready):"
    for item in "${missing[@]}"; do
      echo "   $item"
    done
    echo "   See .env.example for details."
    echo ""
  fi
}

ensure_rust
ensure_hooks
check_agent_env

echo "[refarm-devcontainer] Post-start sanity check complete."
