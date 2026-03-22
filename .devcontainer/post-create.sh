#!/usr/bin/env bash
# .devcontainer/post-create.sh - Optimized setup for Refarm
set -euo pipefail

echo "[refarm-devcontainer] Starting optimized post-create setup..."

# 1. Fix permissions for mounted volumes (CRITICAL for rust-analyzer)
# refarm-npm-cache mounts as root; refarm-cargo-* mount into /usr/local/cargo (rustlang group, vscode is member).
echo "[refarm-devcontainer] Fixing permissions for mounted caches..."
mkdir -p /home/vscode/.npm /home/vscode/.turbo
sudo chown -R vscode:vscode /home/vscode/.npm /home/vscode/.turbo
# Rust/Cargo volumes mount as root/rustlang; ensure vscode can write to bin and rustup if needed
sudo chown -R vscode:rustlang /usr/local/cargo /usr/local/rustup
chmod -R g+w /usr/local/cargo /usr/local/rustup

# 2. Rust Toolchain setup (fast)
echo "[refarm-devcontainer] Adding Rust WASM targets..."
rustup target add wasm32-unknown-unknown
rustup target add wasm32-wasip1 || true
rustup component add rust-src

# 3. Tool installation for specialized WASM tooling.
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

# 4. NPM Dependencies (conditional)
if [ -f package-lock.json ]; then
  echo "[refarm-devcontainer] Running npm ci..."
  npm ci
else
  echo "[refarm-devcontainer] No package-lock.json discovered, skipping npm ci."
fi

# 5. Finalize Environment
echo "[refarm-devcontainer] Finalizing setup..."
npm run hooks:install || true
npx playwright install chromium

echo "[refarm-devcontainer] Tool versions:"
rustc --version
cargo --version
cargo-component --version || true
wasm-tools --version || true
node --version

echo "[refarm-devcontainer] Setup complete."
