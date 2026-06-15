#!/usr/bin/env bash
set -euo pipefail

export PNPM_HOME="${PNPM_HOME:-/home/vscode/.local/share/pnpm}"
export PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PACKAGE_MANAGER_HELPER="$ROOT/scripts/package-manager.sh"

echo "[refarm-devcontainer] Post-start sanity check..."

if [ ! -f "$PACKAGE_MANAGER_HELPER" ]; then
	echo "[refarm-devcontainer][warn] Package manager helper not found: $PACKAGE_MANAGER_HELPER"
	exit 1
fi

# shellcheck disable=SC1090
source "$PACKAGE_MANAGER_HELPER"
PACKAGE_MANAGER="$(resolve_package_manager "$ROOT")"

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
	repair_owned_dir /home/vscode/.local
	repair_owned_dir /home/vscode/.local/state
	repair_owned_dir /home/vscode/.local/share
	repair_owned_dir "$pnpm_home"
	repair_owned_dir "$pnpm_home/bin"
	repair_owned_dir "$pnpm_home/store"
	repair_owned_dir /home/vscode/.config
	repair_owned_dir /home/vscode/.config/gh
	repair_owned_dir /home/vscode/.cache

	corepack prepare --activate || true

	if command -v pnpm >/dev/null 2>&1 && pnpm --version >/dev/null 2>&1; then
		return
	fi

	echo "[refarm-devcontainer][warn] pnpm command is missing or broken; installing corepack-backed wrapper"
	for target in "$pnpm_home/pnpm" "$pnpm_home/bin/pnpm"; do
		cat >"$target" <<'SH'
#!/usr/bin/env bash
exec corepack pnpm "$@"
SH
		chmod +x "$target"
	done
}

ensure_hooks() {
	if [ -d .git ] && [ ! -x .git/hooks/pre-push ]; then
		echo "[refarm-devcontainer] Installing git hooks..."
		run_script_for_package_manager "$PACKAGE_MANAGER" hooks:install >/dev/null 2>&1 || true
	fi
}

ensure_refarm_cli() {
	if command -v refarm >/dev/null 2>&1; then
		return
	fi

	echo "[refarm-devcontainer] Installing missing refarm CLI shim..."
	run_script_for_package_manager "$PACKAGE_MANAGER" cli:install >/dev/null 2>&1 || echo "[refarm-devcontainer][warn] Could not install refarm CLI shim. Run: $(script_command_for_package_manager "$PACKAGE_MANAGER" cli:install)"
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
		local current_user="${USER:-$(id -un)}"
		sudo chown -R "$current_user":"$current_user" /usr/local/rustup /usr/local/cargo >/dev/null 2>&1 || true
	fi

	local installed missing=()
	installed="$(rustup component list --installed 2>/dev/null || true)"

	for component in rust-src clippy rustfmt; do
		if ! grep -Eq "^${component}($|-)" <<<"$installed"; then
			missing+=("$component")
		fi
	done

	if [ ${#missing[@]} -gt 0 ]; then
		echo "[refarm-devcontainer][warn] Missing Rust components: ${missing[*]}"
		echo "[refarm-devcontainer][warn] Run: rustup component add rust-src clippy rustfmt"
	fi
}

check_gh_auth_home() {
	if ! command -v gh >/dev/null 2>&1; then
		return
	fi

	local persisted_config="/home/vscode/.config/gh"
	local root_config="/root/.config/gh"
	local persisted_has_auth=false
	local root_has_auth=false

	if [ -f "$persisted_config/hosts.yml" ] || [ -f "$persisted_config/config.yml" ]; then
		persisted_has_auth=true
	fi
	if [ -f "$root_config/hosts.yml" ] || [ -f "$root_config/config.yml" ]; then
		root_has_auth=true
	fi

	if [ "$persisted_has_auth" = false ] && [ "$root_has_auth" = true ]; then
		echo "[refarm-devcontainer][warn] GitHub CLI auth exists under /root, but the persisted dev user config is empty."
		echo "[refarm-devcontainer][warn] Run: farm vscode /workspaces/refarm gh auth login"
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

ensure_pnpm
ensure_hooks
ensure_refarm_cli
ensure_git_transport
check_rust_baseline
check_coding_agent_tools
check_gh_auth_home
check_agent_env

if [ -x "$ROOT/scripts/env-safety-check.sh" ]; then
	bash "$ROOT/scripts/env-safety-check.sh" --warn || true
else
	echo "[refarm-devcontainer][warn] scripts/env-safety-check.sh is missing"
fi

echo "[refarm-devcontainer] Post-start sanity check complete."
