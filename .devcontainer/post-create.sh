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

# Cargo registry volumes mount as root; ensure vscode can write crate cache
sudo chown -R vscode:vscode /usr/local/cargo/registry /usr/local/cargo/git 2>/dev/null || true

# 2) Node dependencies
if [ -f package-lock.json ]; then
  log "Running npm ci..."
  npm ci
else
  log "No package-lock.json found, running npm install..."
  npm install
fi

# 3) Playwright browsers + AI agent tools (parallel — independent network downloads)
log "Installing Playwright browsers and AI agent tools in parallel..."

retry 2 npx playwright install --with-deps &
PW_PID=$!

retry 2 npm install -g @anthropic-ai/claude-code &
CLAUDE_PID=$!

(
  retry 2 npm install -g @mariozechner/pi-coding-agent || { warn "Pi install failed. Run: npm install -g @mariozechner/pi-coding-agent"; exit 0; }
  if command -v pi >/dev/null 2>&1; then
    retry 2 npx @aretw0/pi-stack || warn "pi-stack install failed. Run: npx @aretw0/pi-stack"
  fi
) &
PI_PID=$!

wait $PW_PID  || warn "Playwright browser installation failed. Retry: npx playwright install --with-deps"
wait $CLAUDE_PID || warn "Claude Code install failed. Run: npm install -g @anthropic-ai/claude-code"
wait $PI_PID  || true

# 4) Finalize
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

log "Post-create setup complete."
