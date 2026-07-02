#!/usr/bin/env bash
# Every-start boot lanes for this workspace (run by the generic entrypoint on every container start).
# Non-fatal. This is the project-specific personalization the entrypoint deliberately does NOT carry.
#
# Convergence target: replace these hand-listed lanes with a config-driven `refarm devcontainer boot` that
# reads the boot declaration from `refarm.config.json` — see
# docs/research/2026-07-02-devcontainer-boot-as-config.md.
set +e

WS="${DEVCONTAINER_WORKSPACE:-$(pwd)}"

if [ -f "$WS/scripts/env-safety-check.sh" ]; then
	bash "$WS/scripts/env-safety-check.sh" --warn || true
fi

# Future lane: the commons watchdog launches here (every start), per
# docs/superpowers/plans/2026-07-02-commons-watchdog.md.
