#!/usr/bin/env bash
set -euo pipefail

echo "[refarm-devcontainer] Starting post-create setup..."

# Fix npm cache permissions if needed
if [ -d "/home/vscode/.npm" ]; then
  echo "[refarm-devcontainer] Fixing npm cache permissions..."
  sudo chown -R 1001:1001 /home/vscode/.npm
fi

# Update npm to latest stable version
echo "[refarm-devcontainer] Updating npm to latest..."
npm install -g npm@latest

# Rust/WASM targets
rustup target add wasm32-unknown-unknown
rustup target add wasm32-wasip1 || true

# Cargo tools used in validations
if ! command -v cargo-component >/dev/null 2>&1; then
  echo "[refarm-devcontainer] Installing cargo-component..."
  cargo install cargo-component
else
  echo "[refarm-devcontainer] cargo-component already installed"
fi

if ! command -v wasm-tools >/dev/null 2>&1; then
  echo "[refarm-devcontainer] Installing wasm-tools..."
  cargo install wasm-tools
else
  echo "[refarm-devcontainer] wasm-tools already installed"
fi

# Workspace dependencies
if [ -f package-lock.json ]; then
  echo "[refarm-devcontainer] Installing npm dependencies (npm ci)..."
  npm ci
else
  echo "[refarm-devcontainer] package-lock.json not found, skipping npm ci"
fi

# Security: Fix known vulnerabilities
echo "[refarm-devcontainer] Running security audit fix..."
npm audit fix --force 2>/dev/null || true

echo "[refarm-devcontainer] Tool versions:"
node --version
npm --version
rustc --version
cargo --version
cargo-component --version || true
wasm-tools --version || true

echo "[refarm-devcontainer] Setup complete."
