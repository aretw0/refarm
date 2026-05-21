#!/usr/bin/env bash
# .devcontainer/post-create.sh - deterministic bootstrap for Refarm devcontainers
set -euo pipefail

export PNPM_HOME="${PNPM_HOME:-/home/vscode/.local/share/pnpm}"
export PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"

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

repair_owned_dir() {
  local dir="$1"
  mkdir -p "$dir" 2>/dev/null || {
    if command -v sudo >/dev/null 2>&1; then
      sudo mkdir -p "$dir"
    else
      return 0
    fi
  }
  if [ ! -w "$dir" ] && command -v sudo >/dev/null 2>&1; then
    sudo chown -R "$(id -u):$(id -g)" "$dir" || true
  fi
}

ensure_pnpm() {
  local pnpm_home="${PNPM_HOME:-/home/vscode/.local/share/pnpm}"
  repair_owned_dir "$pnpm_home"
  repair_owned_dir "$pnpm_home/bin"

  corepack prepare --activate || warn "corepack prepare failed"

  if ! command -v pnpm >/dev/null 2>&1; then
    cat > "$pnpm_home/pnpm" <<'SH'
#!/usr/bin/env bash
exec corepack pnpm "$@"
SH
    chmod +x "$pnpm_home/pnpm"
  fi
}

clean_stale_wizer_optionals() {
  [ -d node_modules/.pnpm ] || return 0

  case "$(uname -s):$(uname -m)" in
    Linux:x86_64|Linux:amd64)
      ;;
    *)
      return 0
      ;;
  esac

  local stale=(
    "@bytecodealliance+wizer-darwin-arm64@*"
    "@bytecodealliance+wizer-darwin-x64@*"
    "@bytecodealliance+wizer-linux-arm64@*"
    "@bytecodealliance+wizer-linux-s390x@*"
    "@bytecodealliance+wizer-win32-x64@*"
  )

  log "Removing stale non-linux-x64 Wizer optional package artifacts..."
  find node_modules/.pnpm -maxdepth 1 -type d \( \
    -name "${stale[0]}" -o \
    -name "${stale[1]}" -o \
    -name "${stale[2]}" -o \
    -name "${stale[3]}" -o \
    -name "${stale[4]}" \
  \) -prune -exec rm -rf {} +

  find node_modules/.pnpm -path "*/node_modules/@bytecodealliance/wizer-darwin-arm64" -exec rm -rf {} + 2>/dev/null || true
  find node_modules/.pnpm -path "*/node_modules/@bytecodealliance/wizer-darwin-x64" -exec rm -rf {} + 2>/dev/null || true
  find node_modules/.pnpm -path "*/node_modules/@bytecodealliance/wizer-linux-arm64" -exec rm -rf {} + 2>/dev/null || true
  find node_modules/.pnpm -path "*/node_modules/@bytecodealliance/wizer-linux-s390x" -exec rm -rf {} + 2>/dev/null || true
  find node_modules/.pnpm -path "*/node_modules/@bytecodealliance/wizer-win32-x64" -exec rm -rf {} + 2>/dev/null || true
}

log "Starting post-create setup..."

# 0) Git symlink support — must run before any checkout/npm ci
# core.symlinks=false (Windows NTFS default) materializes symlinks as regular files.
# In a Linux devcontainer the filesystem supports symlinks natively, so enable it
# and re-checkout any tracked symlinks so they resolve correctly.
log "Ensuring git core.symlinks=true for Linux devcontainer..."
git config core.symlinks true
git ls-files -s | awk '/^120000/ {print $4}' | xargs -r git checkout -- 2>/dev/null || true

log "Configuring git encoding for PT-BR filenames..."
git config core.quotepath false
git config i18n.commitEncoding UTF-8
git config i18n.logOutputEncoding UTF-8

# 1) Cache and tool directories
log "Preparing cache directories and permissions..."
for dir in \
  /home/vscode/.local \
  /home/vscode/.local/state \
  /home/vscode/.local/share \
  /home/vscode/.local/share/pnpm \
  /home/vscode/.local/share/pnpm/bin \
  /home/vscode/.local/share/pnpm/store \
  /home/vscode/.config \
  /home/vscode/.config/gh \
  /home/vscode/.npm-global \
  /home/vscode/.npm-global/bin \
  /home/vscode/.refarm \
  /home/vscode/.pi \
  /home/vscode/.claude \
  /home/vscode/.codex \
  /home/vscode/.turbo \
  /home/vscode/.cache \
  /home/vscode/.cache/ms-playwright \
  /home/vscode/.cache/puppeteer \
  /home/vscode/.cargo-target
  do
  repair_owned_dir "$dir"
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
ensure_pnpm
clean_stale_wizer_optionals
if [ -f pnpm-lock.yaml ]; then
  log "Running pnpm install --frozen-lockfile..."
  pnpm install --frozen-lockfile --config.confirm-modules-purge=false
else
  log "No pnpm-lock.yaml found, running pnpm install..."
  pnpm install --config.confirm-modules-purge=false
fi

# 3) Rust baseline parity for local/CI checks
log "Ensuring Rust baseline targets and components..."
retry 2 rustup target add x86_64-unknown-linux-gnu wasm32-unknown-unknown wasm32-wasip1 \
  || warn "Could not ensure Rust targets. Run: rustup target add x86_64-unknown-linux-gnu wasm32-unknown-unknown wasm32-wasip1"
retry 2 rustup component add rust-src clippy rustfmt \
  || warn "Could not ensure Rust components. Run: rustup component add rust-src clippy rustfmt"

# 4) Playwright browsers + AI agent tools (parallel — independent network downloads)
log "Installing Playwright browsers and AI agent tools in parallel..."

retry 2 pnpm -C validations/sqlite-benchmark/browser exec playwright install --with-deps &
PW_PID=$!

retry 2 npm install -g @mermaid-js/mermaid-cli &
MMDC_PID=$!

retry 2 cargo install mdt_cli --locked --version 0.7.0 &
MDT_PID=$!

(
  retry 2 pnpm add -g @earendil-works/pi-coding-agent || { warn "Pi install failed. Run: pnpm add -g @earendil-works/pi-coding-agent"; exit 0; }
  retry 2 npm install -g @aretw0/pi-stack || { warn "pi-stack install failed. Run: npm install -g @aretw0/pi-stack"; exit 0; }
  if command -v pi >/dev/null 2>&1; then
    node "$(npm root -g)/@aretw0/pi-stack/install.mjs" || warn "pi-stack setup failed. Run: node \$(npm root -g)/@aretw0/pi-stack/install.mjs"
  fi
) &
PI_PID=$!

wait $PW_PID     || warn "Playwright browser installation failed. Retry: pnpm -C validations/sqlite-benchmark/browser exec playwright install --with-deps"
wait $MMDC_PID   || warn "mermaid-cli install failed. Run: npm install -g @mermaid-js/mermaid-cli"
wait $MDT_PID    || warn "mdt_cli install failed. Run: cargo install mdt_cli --locked --version 0.7.0"
wait $PI_PID     || warn "Pi install failed. Run: pnpm add -g @earendil-works/pi-coding-agent"

# 5) Finalize
log "Installing refarm CLI shim..."
pnpm run cli:install || warn "Could not install refarm CLI shim. Retry: pnpm run cli:install"

log "Installing git hooks..."
pnpm run hooks:install || warn "Could not install git hooks automatically"

if [ -f scripts/factory-preflight.mjs ]; then
  log "Running factory preflight..."
  node scripts/factory-preflight.mjs || warn "Factory preflight reported issues. Review output above."
fi

log "Tool versions:"
node --version || true
pnpm --version || true
rustc --version || true
cargo --version || true
cargo-component --version || true
wasm-tools --version || true
pnpm -C validations/sqlite-benchmark/browser exec playwright --version || true
gh --version 2>/dev/null | head -1 || true
rg --version 2>/dev/null | head -1 || true
fd --version 2>/dev/null || true
bwrap --version 2>/dev/null || true
jq --version 2>/dev/null || true
shellcheck --version 2>/dev/null | head -1 || true
shfmt --version 2>/dev/null || true
hyperfine --version 2>/dev/null || true
pi --version 2>/dev/null || true
mmdc --version 2>/dev/null || true

log "Post-create setup complete."
