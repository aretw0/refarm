#!/usr/bin/env bash
set -euo pipefail

echo "[refarm-devcontainer] Post-start sanity check..."

ensure_hooks() {
  if [ -d .git ] && [ ! -x .git/hooks/pre-push ]; then
    echo "[refarm-devcontainer] Installing git hooks..."
    npm run hooks:install >/dev/null 2>&1 || true
  fi
}

check_agent_env() {
  local missing=()

  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    missing+=("ANTHROPIC_API_KEY  → pi /login  ou  claude /login")
  fi
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

ensure_hooks
check_agent_env

echo "[refarm-devcontainer] Post-start sanity check complete."
