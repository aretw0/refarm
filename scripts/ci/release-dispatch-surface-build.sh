#!/usr/bin/env bash
set -euo pipefail

BASE_SHA="${1:-}"
HEAD_SHA="${2:-${GITHUB_SHA:-$(git rev-parse HEAD)}}"
CHECK_ONLY="false"

if [ "${3:-}" = "--check" ] || [ "${3:-}" = "--dry-run" ]; then
	CHECK_ONLY="true"
fi

ZERO_GIT_PREFIX="0000000000000000000000000000000000000000"

if [ -z "$BASE_SHA" ] || [ "$BASE_SHA" = "$ZERO_GIT_PREFIX" ]; then
	BASE_SHA="$HEAD_SHA~1"
fi

if [ -n "$BASE_SHA" ] && ! git cat-file -e "$BASE_SHA"^{commit} 2>/dev/null; then
	BASE_SHA="$HEAD_SHA~1"
fi

if ! git cat-file -e "$BASE_SHA"^{commit} 2>/dev/null; then
	BASE_SHA="$HEAD_SHA"
fi

if ! git cat-file -e "$HEAD_SHA"^{commit} 2>/dev/null; then
	HEAD_SHA="$(git rev-parse HEAD)"
fi

if [ -z "$BASE_SHA" ]; then
	BASE_SHA="$HEAD_SHA"
fi

CHANGED_FILES="$(git diff --name-only "$BASE_SHA" "$HEAD_SHA")"
if [ -z "$CHANGED_FILES" ]; then
	CHANGED_FILES="$(git show --name-only --pretty=format: "$HEAD_SHA")"
fi

if echo "$CHANGED_FILES" | grep -Eq '^(packages/dispatch-surface($|/)|packages/dispatch-surface-rs($|/)|scripts/build-dispatch-surface-rs\.mjs$|specs/features/dispatch-control-plane-contract\.md$|^package\.json$|packages/dispatch-surface/src/|packages/dispatch-surface-rs/src/)'; then
	if [ "$CHECK_ONLY" = "true" ]; then
		echo "run_dispatch_surface_ci=true"
		echo "BASE_SHA=$BASE_SHA"
		echo "HEAD_SHA=$HEAD_SHA"
		exit 0
	fi

	echo "Detected dispatch-surface runtime contract changes; running strict native build."
	echo "BASE_SHA=$BASE_SHA"
	echo "HEAD_SHA=$HEAD_SHA"
	pnpm run dispatch-surface:build-rs:release
else
	if [ "$CHECK_ONLY" = "true" ]; then
		echo "run_dispatch_surface_ci=false"
		echo "BASE_SHA=$BASE_SHA"
		echo "HEAD_SHA=$HEAD_SHA"
		exit 0
	fi

	echo "No dispatch-surface runtime contract changes detected; skipping strict build."
	echo "BASE_SHA=$BASE_SHA"
	echo "HEAD_SHA=$HEAD_SHA"
fi
