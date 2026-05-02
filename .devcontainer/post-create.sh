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

log "Starting post-create setup..."

# 0) Git symlink support — must run before any checkout/npm ci
# core.symlinks=false (Windows NTFS default) materializes symlinks as regular files.
# In a Linux devcontainer the filesystem supports symlinks natively, so enable it
# and re-checkout any tracked symlinks so they resolve correctly.
log "Ensuring git core.symlinks=true for Linux devcontainer..."
git config core.symlinks true
git ls-files -s | awk '/^120000/ {print $4}' | xargs -r git checkout -- 2>/dev/null || true

# 1) Cache and tool directories
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

# Cargo/Rustup volumes may mount with non-vscode ownership; ensure toolchain is writable
sudo chown -R vscode:vscode /usr/local/cargo /usr/local/rustup 2>/dev/null || true

# SSH keepalive: prevents GitHub from closing the connection during slow pre-push hooks
log "Configuring SSH keepalive for GitHub..."
mkdir -p /home/vscode/.ssh
chmod 700 /home/vscode/.ssh
if ! grep -q "# refarm-keepalive" /home/vscode/.ssh/config 2>/dev/null; then
  cat >> /home/vscode/.ssh/config << 'EOF'
# refarm-keepalive
Host github.com
  ServerAliveInterval 30
  ServerAliveCountMax 10
EOF
  chmod 600 /home/vscode/.ssh/config
fi

# Git transport fallback for Docker Desktop terminals:
# if SSH agent forwarding isn't available, rewrite git@github.com:* to https://github.com/*
# and rely on GH auth token/credential helper.
log "Configuring GitHub transport fallback (ssh -> https) for git operations..."
git config --global url."https://github.com/".insteadOf "git@github.com:"
if gh auth status -h github.com >/dev/null 2>&1; then
  gh auth setup-git >/dev/null 2>&1 || true
fi

# 2) Node dependencies
if [ -f package-lock.json ]; then
  log "Running npm ci..."
  npm ci
else
  log "No package-lock.json found, running npm install..."
  npm install
fi

# 3) Rust baseline parity for local/CI checks
log "Ensuring Rust baseline targets and components..."
retry 2 rustup target add x86_64-unknown-linux-gnu wasm32-unknown-unknown wasm32-wasip1 \
  || warn "Could not ensure Rust targets. Run: rustup target add x86_64-unknown-linux-gnu wasm32-unknown-unknown wasm32-wasip1"
retry 2 rustup component add rust-src clippy rustfmt \
  || warn "Could not ensure Rust components. Run: rustup component add rust-src clippy rustfmt"

# 4) Playwright browsers + AI agent tools (parallel — independent network downloads)
log "Installing Playwright browsers and AI agent tools in parallel..."

retry 2 npx playwright install --with-deps &
PW_PID=$!

retry 2 npm install -g @anthropic-ai/claude-code &
CLAUDE_PID=$!

retry 2 npm install -g @mermaid-js/mermaid-cli &
MMDC_PID=$!

(
  retry 2 npm install -g @mariozechner/pi-coding-agent || { warn "Pi install failed. Run: npm install -g @mariozechner/pi-coding-agent"; exit 0; }
  retry 2 npm install -g @aretw0/pi-stack || { warn "pi-stack install failed. Run: npm install -g @aretw0/pi-stack"; exit 0; }
  if command -v pi >/dev/null 2>&1; then
    # Run install.mjs directly to avoid IS_MAIN=false when invoked via bin symlink
    node "$(npm root -g)/@aretw0/pi-stack/install.mjs" || warn "pi-stack setup failed. Run: node \$(npm root -g)/@aretw0/pi-stack/install.mjs"
  fi
) &
PI_PID=$!

wait $PW_PID   || warn "Playwright browser installation failed. Retry: npx playwright install --with-deps"
wait $CLAUDE_PID || warn "Claude Code install failed. Run: npm install -g @anthropic-ai/claude-code"
wait $MMDC_PID || warn "mermaid-cli install failed. Run: npm install -g @mermaid-js/mermaid-cli"
wait $PI_PID   || true

# 5) Finalize
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
gh --version 2>/dev/null | head -1 || true
pi --version 2>/dev/null || true
claude --version 2>/dev/null || true
mmdc --version 2>/dev/null || true

log "Post-create setup complete."
