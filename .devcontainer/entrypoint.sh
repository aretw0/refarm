#!/usr/bin/env bash
# refarm devcontainer entrypoint.
#
# Runs must-run-on-EVERY-start setup, then keeps the container alive. Unlike `postStartCommand`
# (post-start.sh) — which the Dev Containers tooling runs only on VS Code / devcontainer-CLI attach — this
# runs on every container start, including a bare `docker start` / Docker Desktop bring-up.
#
# Two invariants keep it safe:
#   1. setup is NON-FATAL and time-bounded — it can never block or prevent the container from coming up;
#   2. the keep-alive is a verbatim copy of the Dev Containers override (from `docker inspect`), so attach
#      behaviour is unchanged.
#
# Revert (if a rebuild misbehaves): remove `"overrideCommand": false` from devcontainer.json and the
# COPY/chmod/ENTRYPOINT lines from the Dockerfile, then rebuild — that restores the default override.
set +e

ROOT="/workspaces/refarm"

# --- must-run-on-every-start setup (non-fatal, bounded) ---
if [ -f "$ROOT/scripts/env-safety-check.sh" ]; then
	timeout 30 bash "$ROOT/scripts/env-safety-check.sh" --warn 2>&1 | sed 's/^/[entrypoint] /' || true
fi
# Future: the commons watchdog launches here (every start), per docs/superpowers/plans/2026-07-02-commons-watchdog.md.
# Convergence target: replace this block with `refarm devcontainer boot` (config-driven), per
# docs/research/2026-07-02-devcontainer-boot-as-config.md.

# --- keep-alive: verbatim from the Dev Containers override (docker inspect) ---
echo "Container started"
trap "exit 0" 15
exec "$@"
while sleep 1 & wait $!; do :; done
