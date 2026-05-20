#!/usr/bin/env bash
# rust-clean.sh — free disk space consumed by Rust build artifacts.
#
# Usage:
#   ./scripts/rust-clean.sh             # clean incremental/stale artifacts only
#   ./scripts/rust-clean.sh --full      # delete entire target/ directories
#   ./scripts/rust-clean.sh --check     # report sizes without deleting
#
# Motivation: wasmtime, component builds, and integration-test fixtures can leave
# multi-GB target/ trees. On Windows-backed WSL/Docker Desktop hosts, deleting
# these artifacts may also require `wsl --shutdown` / VHDX compaction before the
# host OS reports the space as reclaimed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-}"

# When CARGO_TARGET_DIR is set (devcontainer volume redirect), that directory
# accumulates all build artifacts instead of each package's own target/ tree.
VOLUME_TARGET="${CARGO_TARGET_DIR:-}"

# Rust packages/workspaces in this repo that can own target/ directories.
# Keep this explicit so cleanup remains predictable and source-safe.
RUST_PACKAGES=(
	"packages/tractor"
	"packages/agent-tools"
	"packages/heartwood"
	"packages/pi-agent"
	"packages/tractor/tests/fixtures/null-plugin"
	"templates/rust-plugin"
	"validations/simple-wasm-plugin"
	"validations/wasm-plugin/hello-world"
)

size_mb() {
	du -sm "$1" 2>/dev/null | cut -f1 || echo 0
}

print_disk_free() {
	df -h "$REPO_ROOT" 2>/dev/null | tail -1 | awk '{print "  Disk free: " $4 " of " $2 " on " $6}'
}

clean_target_tree() {
	local label="$1"
	local target="$2"
	if [ ! -d "$target" ]; then
		return
	fi

	local before
	before="$(size_mb "$target")"

	# Incremental caches are safe to delete and are rebuilt on the next cargo run.
	find "$target" -path "*/incremental" -type d -prune -exec rm -rf '{}' + 2>/dev/null || true

	# Stale object/dependency files from tests are often the largest low-value set.
	find "$target" -path "*/deps/*.rcgu.o" -type f -delete 2>/dev/null || true
	find "$target" -path "*/deps/*.d" -type f -delete 2>/dev/null || true

	# Documentation and temporary package outputs are regenerated on demand.
	rm -rf "$target/doc" "$target/package" 2>/dev/null || true

	local after
	after="$(size_mb "$target")"
	local freed=$((before - after))
	echo "  $label: ${before}M -> ${after}M (freed ${freed}M)"
}

# ── Check mode: report sizes only ──────────────────────────────────────────────
if [ "$MODE" = "--check" ]; then
	echo "Rust build artifact sizes:"
	TOTAL=0
	for pkg in "${RUST_PACKAGES[@]}"; do
		TARGET="$REPO_ROOT/$pkg/target"
		if [ -d "$TARGET" ]; then
			SIZE="$(size_mb "$TARGET")"
			printf "  %6sM  %s/target\n" "$SIZE" "$pkg"
			TOTAL=$((TOTAL + SIZE))
		fi
	done
	if [ -n "$VOLUME_TARGET" ] && [ -d "$VOLUME_TARGET" ]; then
		SIZE="$(size_mb "$VOLUME_TARGET")"
		printf "  %6sM  %s  (CARGO_TARGET_DIR volume)\n" "$SIZE" "$VOLUME_TARGET"
		TOTAL=$((TOTAL + SIZE))
	fi
	echo "  ─────────────────"
	printf "  %6sM  total\n" "$TOTAL"
	print_disk_free
	exit 0
fi

# ── Full clean mode: rm -rf target/ ────────────────────────────────────────────
if [ "$MODE" = "--full" ]; then
	echo "Full clean: removing Rust target/ directories..."
	for pkg in "${RUST_PACKAGES[@]}"; do
		TARGET="$REPO_ROOT/$pkg/target"
		if [ -d "$TARGET" ]; then
			SIZE="$(size_mb "$TARGET")"
			echo "  Removing $pkg/target (${SIZE}M)"
			rm -rf "$TARGET"
		fi
	done
	if [ -n "$VOLUME_TARGET" ] && [ -d "$VOLUME_TARGET" ]; then
		SIZE="$(size_mb "$VOLUME_TARGET")"
		echo "  Removing $VOLUME_TARGET (${SIZE}M)  [CARGO_TARGET_DIR volume]"
		rm -rf "$VOLUME_TARGET"
		mkdir -p "$VOLUME_TARGET"
	fi
	echo "Done. Run package-scoped cargo commands to rebuild only what you need."
	print_disk_free
	exit 0
fi

if [ -n "$MODE" ]; then
	echo "Unknown mode: $MODE" >&2
	echo "Expected: --check, --full, or no argument" >&2
	exit 2
fi

# ── Default: surgical clean (incremental + stale generated artifacts) ──────────
echo "Cleaning Rust incremental build caches and stale generated artifacts..."

for pkg in "${RUST_PACKAGES[@]}"; do
	TARGET="$REPO_ROOT/$pkg/target"
	clean_target_tree "$pkg/target" "$TARGET"
done

if [ -n "$VOLUME_TARGET" ] && [ -d "$VOLUME_TARGET" ]; then
	clean_target_tree "$VOLUME_TARGET (CARGO_TARGET_DIR volume)" "$VOLUME_TARGET"
fi

echo ""
echo "Tip: npm run clean:light  # Rust incremental + .turbo"
echo "Tip: npm run clean:heavy  # remove whole target/ dirs; requires rebuild"
print_disk_free
