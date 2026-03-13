#!/usr/bin/env bash
set -euo pipefail

echo "[refarm-devcontainer] Starting post-create setup..."

# Fix npm cache permissions if needed
if [ -d "/home/vscode/.npm" ]; then
  echo "[refarm-devcontainer] Fixing npm cache permissions..."
  sudo chown -R vscode:vscode /home/vscode/.npm
fi

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

# Install git hooks for pre-push validation
echo "[refarm-devcontainer] Installing git hooks..."
npm run hooks:install || true

# Install Playwright browser dependencies and Chromium binary
echo "[refarm-devcontainer] Installing Playwright Chromium..."
npx playwright install chromium
echo "[refarm-devcontainer] Installing Playwright system dependencies..."
cd validations/wasm-plugin/host && sudo npx playwright install-deps && cd - >/dev/null || true

echo "[refarm-devcontainer] Tool versions:"
node --version
npm --version
rustc --version
cargo --version
cargo-component --version || true
wasm-tools --version || true

echo "[refarm-devcontainer] Setup complete."
