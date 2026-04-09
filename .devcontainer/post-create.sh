#!/usr/bin/env bash
# .devcontainer/post-create.sh - Optimized setup for Refarm using Turborepo
set -euo pipefail

echo "[refarm-devcontainer] Starting optimized post-create setup..."

# 1. Fix permissions for mounted volumes
# Ensure vscode user owns the npm, turbo, and playwright cache directories.
echo "[refarm-devcontainer] Fixing permissions for mounted caches..."
sudo chown -R vscode:vscode /home/vscode
mkdir -p /home/vscode/.npm /home/vscode/.npm-global/bin /home/vscode/.turbo /home/vscode/.cache/ms-playwright /home/vscode/.cache/puppeteer
sudo chown -R vscode:vscode /home/vscode/.npm /home/vscode/.npm-global /home/vscode/.turbo /home/vscode/.cache/ms-playwright /home/vscode/.cache/puppeteer
# Rust/Cargo volumes mount as root/rustlang; ensure vscode can write to bin and rustup if needed
sudo chown -R vscode:rustlang /usr/local/cargo /usr/local/rustup
chmod -R g+w /usr/local/cargo /usr/local/rustup

# 2. NPM Dependencies
# npm ci is still run here to ensure node_modules are installed for the current project.
# The Turborepo cache for node_modules is not as effective as npm's own cache.
if [ -f package-lock.json ]; then
  echo "[refarm-devcontainer] Running npm ci..."
  npm ci
else
  echo "[refarm-devcontainer] No package-lock.json discovered, running npm install..."
  npm install
fi

# 3. Rust tooling.
echo "[refarm-devcontainer] Setting up Rust toolchain and specialized WASM tooling..."
rustup default stable
rustup target add x86_64-unknown-linux-gnu
rustup target add wasm32-unknown-unknown
rustup target add wasm32-wasip1 || true
rustup target add wasm32-wasip2 || true
# TODO: wasm32-wasip3 is currently not available on stable, but we can add it when it is. For now, we can rely on the fact that the rustup component for rust-src will allow us to build against the latest nightly toolchain if needed.
# rustup target add wasm32-wasip3 || true
rustup component add rust-src

# BIN_DIR must match CARGO_HOME (set by devcontainer rust feature to /usr/local/cargo).
BIN_DIR="${CARGO_HOME:-/usr/local/cargo}/bin"

# wasm-tools (v1.245.1) — has prebuilt binaries, installs in seconds.
if ! command -v wasm-tools >/dev/null 2>&1; then
  echo "[refarm-devcontainer] Installing wasm-tools v1.245.1 via binary..."
  TEMP_DIR=$(mktemp -d)
  URL="https://github.com/bytecodealliance/wasm-tools/releases/download/v1.245.1/wasm-tools-1.245.1-x86_64-linux.tar.gz"
  curl -fsSL "$URL" | tar -xz -C "$TEMP_DIR"
  # Archive structure: wasm-tools-1.245.1-x86_64-linux/wasm-tools
  find "$TEMP_DIR" -maxdepth 2 -name "wasm-tools" -type f -exec mv {} "$BIN_DIR/" \;
  rm -rf "$TEMP_DIR"
else
  echo "[refarm-devcontainer] wasm-tools already present"
fi

# cargo-component (v0.21.1) — no prebuilt binaries published upstream; compiled from source.
# The cargo registry volume cache (/usr/local/cargo/registry) keeps deps across rebuilds.
if ! command -v cargo-component >/dev/null 2>&1; then
  echo "[refarm-devcontainer] Installing cargo-component v0.21.1 via cargo install (first build only)..."
  cargo install --locked cargo-component@0.21.1
else
  echo "[refarm-devcontainer] cargo-component already present"
fi

# 4. Install Playwright browsers
echo "[refarm-devcontainer] Installing Playwright browsers..."
npx playwright install --with-deps

# 5. Finalize Environment
echo "[refarm-devcontainer] Finalizing setup..."
npm run hooks:install

echo "[refarm-devcontainer] Tool versions:"
node --version
rustc --version
cargo --version
cargo-component --version
wasm-tools --version
npx playwright --version

echo "[refarm-devcontainer] Setup complete."
