#!/usr/bin/env bash
# Generic devcontainer entrypoint — project-agnostic.
#
# Runs the workspace's every-start boot hook (`.devcontainer/on-start.sh`, non-fatal + time-bounded), then
# keeps the container alive with the verbatim Dev Containers keep-alive. Unlike `postStartCommand`, which
# the tooling runs only on VS Code / devcontainer-CLI attach, this runs on EVERY container start (a bare
# `docker start` / Docker Desktop bring-up included).
#
# It carries NO project specifics: the workspace path is derived, and the lanes live in `on-start.sh`
# (which converges to a config-driven `<project> devcontainer boot`). Two invariants keep it safe:
#   1. the boot hook is non-fatal and bounded — it can never block the container from coming up;
#   2. the keep-alive is verbatim from the Dev Containers override, so attach behaviour is unchanged.
#
# Revert (if a rebuild misbehaves): remove `"overrideCommand": false` from devcontainer.json and the
# COPY/chmod/ENTRYPOINT lines from the Dockerfile, then rebuild.
set +e

export DEVCONTAINER_WORKSPACE="$(pwd)"
if [ -f "$DEVCONTAINER_WORKSPACE/.devcontainer/on-start.sh" ]; then
	timeout 60 bash "$DEVCONTAINER_WORKSPACE/.devcontainer/on-start.sh" 2>&1 | sed 's/^/[boot] /' || true
fi

# --- keep-alive: verbatim from the Dev Containers override (docker inspect) ---
echo "Container started"
trap "exit 0" 15
exec "$@"
while sleep 1 & wait $!; do :; done
