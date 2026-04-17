#!/usr/bin/env bash
# .devcontainer/post-create.sh - deterministic bootstrap for Refarm devcontainers
set -euo pipefail

log() {
  echo "[refarm-devcontainer] $*"
}

warn() {
  echo "[refarm-devcontainer][warn] $*"
}

retry() {
  local attempts="$1"
  shift

  local current=1
  until "$@"; do
    if [ "$current" -ge "$attempts" ]; then
      return 1
    fi
    current=$((current + 1))
    sleep 2
  done
}

ensure_wasm_tools() {
  local bin_dir="$1"
  local temp_dir
  temp_dir=$(mktemp -d)
  local url="https://github.com/bytecodealliance/wasm-tools/releases/download/v1.245.1/wasm-tools-1.245.1-x86_64-linux.tar.gz"

  curl -fsSL "$url" | tar -xz -C "$temp_dir"
  find "$temp_dir" -maxdepth 2 -name "wasm-tools" -type f -exec mv {} "$bin_dir/" \;
  rm -rf "$temp_dir"
}

log "Starting post-create setup..."

# 1) Cache and tool directories (only targeted directories, no broad chown on /home/vscode)
log "Preparing cache directories and permissions..."
for dir in \
  /home/vscode/.npm \
  /home/vscode/.npm-global \
  /home/vscode/.npm-global/bin \
  /home/vscode/.turbo \
  /home/vscode/.cache \
  /home/vscode/.cache/ms-playwright \
  /home/vscode/.cache/puppeteer
  do
  mkdir -p "$dir"
  sudo chown -R vscode:vscode "$dir"
done

# Rust volumes may be mounted as root; keep writable for vscode user
sudo chown -R vscode:vscode /usr/local/cargo /usr/local/rustup || true
chmod -R u+rwX,g+rwX /usr/local/cargo /usr/local/rustup || true

# 2) Node dependencies
if [ -f package-lock.json ]; then
  log "Running npm ci..."
  npm ci
else
  log "No package-lock.json found, running npm install..."
  npm install
fi

# 3) Rust toolchain sanity (self-healing)
log "Validating Rust toolchain..."
if ! rustup toolchain list | grep -q '^stable'; then
  log "Stable toolchain missing. Installing..."
  retry 3 rustup toolchain install stable --profile minimal
fi

retry 3 rustup default stable

if ! rustup show active-toolchain >/dev/null 2>&1; then
  warn "Active toolchain state is unhealthy. Reinstalling stable..."
  retry 3 rustup toolchain install stable --profile minimal
  retry 3 rustup default stable
fi

if ! RUSTUP_TOOLCHAIN=stable rustc -vV >/dev/null 2>&1; then
  warn "RUSTUP_TOOLCHAIN=stable failed (manifest drift). Reinstalling stable alias..."
  retry 3 rustup toolchain install stable --profile minimal
fi

for target in x86_64-unknown-linux-gnu wasm32-unknown-unknown wasm32-wasip1; do
  retry 3 rustup target add "$target" || warn "Could not install Rust target: $target"
done

retry 3 rustup component add rust-src || warn "Could not install rust-src component"

# 4) WASM tools
bin_dir="${CARGO_HOME:-/usr/local/cargo}/bin"
mkdir -p "$bin_dir"

if ! command -v wasm-tools >/dev/null 2>&1; then
  log "Installing wasm-tools v1.245.1..."
  retry 3 ensure_wasm_tools "$bin_dir" || warn "Failed to install wasm-tools"
else
  log "wasm-tools already present"
fi

if ! command -v cargo-component >/dev/null 2>&1; then
  log "Installing cargo-component v0.21.1 (first build can take a while)..."
  retry 2 cargo install --locked cargo-component@0.21.1 || warn "Failed to install cargo-component"
else
  log "cargo-component already present"
fi

# 5) Playwright browsers (non-fatal, often network-sensitive)
log "Installing Playwright browsers..."
if ! retry 2 npx playwright install --with-deps; then
  warn "Playwright browser installation failed. You can retry with: npx playwright install --with-deps"
fi

# 6) Finalize
log "Installing git hooks..."
npm run hooks:install || warn "Could not install git hooks automatically"

if [ -f scripts/factory-preflight.mjs ]; then
  log "Running factory preflight..."
  node scripts/factory-preflight.mjs || warn "Factory preflight reported issues. Review output above."
fi

log "Tool versions:"
node --version || true
npm --version || true
rustc --version || true
cargo --version || true
cargo-component --version || true
wasm-tools --version || true
npx playwright --version || true

log "Post-create setup complete."
