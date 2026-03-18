#!/bin/bash

# Purge Artifacts from Git History
# This script removes erroneously committed .js, .d.ts and .map files from all src/ directories.
# Requires: git-filter-repo (pip install git-filter-repo)

set -e

echo "--- Preparing to purge artifacts from Git history ---"

# Step 1: Capture the original remote URL
ORIGINAL_REMOTE_URL=$(git remote get-url origin 2>/dev/null)
if [ -z "$ORIGINAL_REMOTE_URL" ]; then
    echo "Error: No 'origin' remote found. Please run this in the root of the refarm repository."
    exit 1
fi

echo "Captured remote: $ORIGINAL_REMOTE_URL"
echo "Target patterns to REMOVE from history (Surgical Purge):"
echo " - .js and .d.ts only in packages/{plugin-manifest,identity-contract-v1,storage-contract-v1,sync-contract-v1}/src/"
echo " - .js.map and .d.ts.map in ANY packages/*/src/"

# Step 2: Create a backup mirror outside the repo
REPO_PATH="$(pwd)"
REPO_NAME="$(basename "$REPO_PATH")"
PARENT_PATH="$(dirname "$REPO_PATH")"
BACKUP_DIR="${PARENT_PATH}/${REPO_NAME}.purge.bak"

echo "Creating safety backup at: $BACKUP_DIR"
if [ -d "$BACKUP_DIR" ]; then
    rm -rf "$BACKUP_DIR"
fi

(cd "$PARENT_PATH" && git clone --mirror "$REPO_NAME" "$(basename "$BACKUP_DIR")")

# Step 3: Run git-filter-repo with globs
# We use --path-glob to target known artifacts in src directories.
# --invert-paths tells filter-repo to DELETE these matching paths.
echo "--- Running git-filter-repo (Surgical Purge) ---"
git filter-repo \
    --path-glob 'packages/plugin-manifest/src/**/*.js' \
    --path-glob 'packages/plugin-manifest/src/**/*.d.ts' \
    --path-glob 'packages/identity-contract-v1/src/**/*.js' \
    --path-glob 'packages/identity-contract-v1/src/**/*.d.ts' \
    --path-glob 'packages/storage-contract-v1/src/**/*.js' \
    --path-glob 'packages/storage-contract-v1/src/**/*.d.ts' \
    --path-glob 'packages/sync-contract-v1/src/**/*.js' \
    --path-glob 'packages/sync-contract-v1/src/**/*.d.ts' \
    --path-glob 'packages/*/src/**/*.js.map' \
    --path-glob 'packages/*/src/**/*.d.ts.map' \
    --invert-paths \
    --force

# Step 4: Restore remote
echo "--- Restoring remote configuration ---"
git remote add origin "$ORIGINAL_REMOTE_URL"

echo "Success! The history has been rewritten locally."
echo "CRITICAL: You must force-push to update the server:"
echo "  git push origin --force --all"
echo "  git push origin --force --tags"
echo ""
echo "Note: Instruct other collaborators to re-clone or reset their local branches."
