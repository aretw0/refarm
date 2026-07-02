#!/usr/bin/env bash
# Every-start boot lanes for this workspace (run by the generic entrypoint on every container start).
# Non-fatal. This is the project-specific personalization the entrypoint deliberately does NOT carry.
#
# Lanes run AS THE DEV USER, not root. The entrypoint is PID 1 (root); the checks expect to run as the
# workspace owner — running them as root yields false owner mismatches (uid=1001 vs current=0). `farm` (the
# enter-as-dev-user helper) is the convergence-aligned way to drop to the dev user with the project env;
# fall back to a direct run when already non-root or farm is unavailable.
#
# Convergence target: replace these hand-listed lanes with a config-driven `refarm devcontainer boot` that
# reads the boot declaration from `refarm.config.json` — see
# docs/research/2026-07-02-devcontainer-boot-as-config.md.
set +e

WS="${DEVCONTAINER_WORKSPACE:-$(pwd)}"

run_lane() {
	if [ "$(id -u)" = "0" ] && command -v farm >/dev/null 2>&1; then
		farm vscode "$WS" "$@" || true
	else
		( cd "$WS" && "$@" ) || true
	fi
}

if [ -f "$WS/scripts/env-safety-check.sh" ]; then
	run_lane bash scripts/env-safety-check.sh --warn
fi

# Future lane: the commons watchdog launches here (every start), per
# docs/superpowers/plans/2026-07-02-commons-watchdog.md.
