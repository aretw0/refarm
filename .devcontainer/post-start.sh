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

ensure_rust
ensure_hooks

echo "[refarm-devcontainer] Post-start sanity check complete."
