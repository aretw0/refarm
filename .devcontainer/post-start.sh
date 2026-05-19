#!/usr/bin/env bash
set -euo pipefail

echo "[refarm-devcontainer] Post-start sanity check..."

ensure_hooks() {
  if [ -d .git ] && [ ! -x .git/hooks/pre-push ]; then
    echo "[refarm-devcontainer] Installing git hooks..."
    pnpm run hooks:install >/dev/null 2>&1 || true
  fi
}

ensure_git_transport() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return
  fi

  local origin_url
  origin_url="$(git remote get-url origin 2>/dev/null || true)"
  if [ -z "$origin_url" ]; then
    return
  fi

  # Docker Desktop terminals often lack host SSH agent forwarding. Force HTTPS fallback
  # for git@github.com remotes so `git push` works via GH token credentials.
  if [[ "$origin_url" == git@github.com:* ]]; then
    git config --global url."https://github.com/".insteadOf "git@github.com:"

    if gh auth status -h github.com >/dev/null 2>&1; then
      gh auth setup-git >/dev/null 2>&1 || true
      if git ls-remote --heads origin >/dev/null 2>&1; then
        echo "[refarm-devcontainer] GitHub remote ready (ssh->https fallback active)."
      else
        echo "[refarm-devcontainer][warn] GitHub remote still unreachable. Run: gh auth login"
      fi
    else
      echo "[refarm-devcontainer][warn] GitHub auth missing. Run: gh auth login"
    fi
  fi
}

check_rust_baseline() {
  if ! command -v rustup >/dev/null 2>&1; then
    return
  fi

  if [ ! -w /usr/local/rustup/downloads ] || [ ! -w /usr/local/cargo ]; then
    sudo chown -R "$USER":"$USER" /usr/local/rustup /usr/local/cargo >/dev/null 2>&1 || true
  fi

  local installed missing=()
  installed="$(rustup component list --installed 2>/dev/null || true)"

  for component in rust-src clippy rustfmt; do
    if ! grep -Eq "^${component}($|-)" <<< "$installed"; then
      missing+=("$component")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    echo "[refarm-devcontainer][warn] Missing Rust components: ${missing[*]}"
    echo "[refarm-devcontainer][warn] Run: rustup component add rust-src clippy rustfmt"
  fi
}

check_agent_env() {
  local missing=()

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

check_coding_agent_tools() {
  local missing=()

  for tool in bwrap fd rg jq shellcheck shfmt pi; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing+=("$tool")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    echo "[refarm-devcontainer][warn] Missing coding-agent tools: ${missing[*]}"
    echo "[refarm-devcontainer][warn] Rebuild the devcontainer so Dockerfile tool installs are applied."
  fi

  if command -v bwrap >/dev/null 2>&1; then
    if ! bwrap --ro-bind / / true >/dev/null 2>&1; then
      echo "[refarm-devcontainer][warn] bubblewrap is installed but cannot create namespaces."
      echo "[refarm-devcontainer][warn] Rebuild/reopen with devcontainer runArgs, or enable unprivileged user namespaces on the host."
    fi
  fi
}

ensure_hooks
ensure_git_transport
check_rust_baseline
check_coding_agent_tools
check_agent_env

echo "[refarm-devcontainer] Post-start sanity check complete."
