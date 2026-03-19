#!/usr/bin/env bash
# rust-clean.sh — Free disk space consumed by Rust build artifacts.
#
# Usage:
#   ./scripts/rust-clean.sh             # clean all Rust targets in this repo
#   ./scripts/rust-clean.sh --full      # also delete the entire target directory
#   ./scripts/rust-clean.sh --check     # report sizes without deleting
#
# Motivation: wasmtime + bundled SQLite produce ~10 GB of incremental build
# artifacts. This is especially painful on Windows-backed WSL mounts (C:\)
# where free space is limited.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-}"

# Rust workspaces / packages that have their own target/ directory
RUST_PACKAGES=(
  "packages/tractor-native"
  "packages/heartwood"
  "validations/wasm-plugin/hello-world"
  "validations/simple-wasm-plugin"
)

# ── Check mode: report sizes only ──────────────────────────────────────────────
if [ "$MODE" = "--check" ]; then
  echo "Rust build artifact sizes:"
  TOTAL=0
  for pkg in "${RUST_PACKAGES[@]}"; do
    TARGET="$REPO_ROOT/$pkg/target"
    if [ -d "$TARGET" ]; then
      SIZE=$(du -sm "$TARGET" 2>/dev/null | cut -f1)
      echo "  ${SIZE}M  $pkg/target"
      TOTAL=$((TOTAL + SIZE))
    fi
  done
  echo "  ─────────────────"
  echo "  ${TOTAL}M  total"
  df -h /workspaces/refarm 2>/dev/null | tail -1 | awk '{print "  Disk free: " $4 " of " $2}'
  exit 0
fi

# ── Full clean mode: rm -rf target/ ────────────────────────────────────────────
if [ "$MODE" = "--full" ]; then
  echo "Full clean: removing target/ directories..."
  for pkg in "${RUST_PACKAGES[@]}"; do
    TARGET="$REPO_ROOT/$pkg/target"
    if [ -d "$TARGET" ]; then
      SIZE=$(du -sm "$TARGET" 2>/dev/null | cut -f1)
      echo "  Removing $pkg/target (${SIZE}M)"
      rm -rf "$TARGET"
    fi
  done
  echo "Done. Run 'cargo build' to rebuild."
  exit 0
fi

# ── Default: surgical clean (incremental + old test binaries) ──────────────────
echo "Cleaning Rust incremental build caches and stale test binaries..."

for pkg in "${RUST_PACKAGES[@]}"; do
  TARGET="$REPO_ROOT/$pkg/target"
  if [ -d "$TARGET" ]; then
    BEFORE=$(du -sm "$TARGET" 2>/dev/null | cut -f1)

    # Remove incremental compilation artifacts (safe to delete; rebuilt on next cargo build)
    rm -rf "$TARGET/debug/incremental" "$TARGET/release/incremental" 2>/dev/null || true

    # Remove stale test binaries (executables + their .d/.rcgu.o object files)
    find "$TARGET/debug/deps" -maxdepth 1 \
      \( -name "*.rcgu.o" -o -name "*.d" \) \
      -delete 2>/dev/null || true

    # Remove doc artifacts (regenerated on demand)
    rm -rf "$TARGET/doc" 2>/dev/null || true

    AFTER=$(du -sm "$TARGET" 2>/dev/null | cut -f1)
    FREED=$((BEFORE - AFTER))
    echo "  $pkg/target: ${BEFORE}M → ${AFTER}M (freed ${FREED}M)"
  fi
done

echo ""
echo "Tip: use --full to remove entire target/ directories (requires full rebuild)."
echo "Tip: use --check to see current sizes without cleaning."
