#!/usr/bin/env bash
# workspace-clean.sh — cleanup tiers for low-disk local development.
#
# Usage:
#   ./scripts/workspace-clean.sh light   # Rust incremental + .turbo
#   ./scripts/workspace-clean.sh medium  # light + coverage/artifacts
#   ./scripts/workspace-clean.sh heavy   # medium + full Rust target removal
#
# All targets are derived artifacts. Source files and node_modules are left alone.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-light}"

remove_named_dirs() {
	local name="$1"
	echo "Removing $name directories..."
	find "$REPO_ROOT" -xdev -name "$name" -type d -prune -print -exec rm -rf '{}' + 2>/dev/null || true
}

remove_optional_dirs() {
	local rel
	for rel in "$@"; do
		local path="$REPO_ROOT/$rel"
		if [ -d "$path" ]; then
			local size
			size="$(du -sm "$path" 2>/dev/null | cut -f1 || echo 0)"
			echo "Removing $rel (${size}M)"
			rm -rf "$path"
		fi
	done
}

case "$MODE" in
light)
	bash "$REPO_ROOT/scripts/rust-clean.sh"
	remove_named_dirs .turbo
	;;
medium)
	bash "$REPO_ROOT/scripts/rust-clean.sh"
	remove_named_dirs .turbo
	remove_named_dirs coverage
	remove_optional_dirs .artifacts artifacts
	;;
heavy)
	bash "$REPO_ROOT/scripts/rust-clean.sh" --full
	remove_named_dirs .turbo
	remove_named_dirs coverage
	remove_optional_dirs .artifacts artifacts
	;;
*)
	echo "Unknown cleanup mode: $MODE" >&2
	echo "Expected one of: light, medium, heavy" >&2
	exit 2
	;;
esac

echo ""
echo "Cleanup '$MODE' complete. Current repo filesystem:"
df -h "$REPO_ROOT" 2>/dev/null | awk 'NR == 1 || NR == 2 { print "  " $0 }'
