#!/usr/bin/env bash
# disk-check.sh — lightweight disk pressure report for local survival-mode dev.
#
# This script is intentionally read-only. It measures the repo's common derived
# artifact classes so agents and humans can decide which cleanup tier to run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Keep scans bounded and timeout size probes. A low-disk machine should get a
# quick answer, not spend minutes traversing huge build trees.
DU_TIMEOUT_SECONDS="${DU_TIMEOUT_SECONDS:-5}"

CACHE_DIR="$(mktemp -d)"
trap 'rm -rf "$CACHE_DIR"' EXIT

max_depth_for() {
	case "$1" in
	target) echo 7 ;;
	node_modules) echo 3 ;;
	*) echo 4 ;;
	esac
}

human_mb() {
	awk -v mb="${1:-0}" 'BEGIN {
    if (mb < 0) printf "timeout";
    else if (mb >= 1024) printf "%.1fG", mb / 1024;
    else printf "%dM", mb;
  }'
}

cache_file_for() {
	local name="$1"
	printf '%s/%s.tsv' "$CACHE_DIR" "${name//[^A-Za-z0-9_.-]/_}"
}

find_named_dirs() {
	local name="$1"
	local max_depth
	max_depth="$(max_depth_for "$name")"
	case "$name" in
	target | node_modules)
		find . -xdev -maxdepth "$max_depth" -name "$name" -type d -prune -print0 2>/dev/null
		;;
	*)
		find . -xdev -maxdepth "$max_depth" \
			\( -name node_modules -o -name target \) -type d -prune \
			-o -name "$name" -type d -print0 2>/dev/null
		;;
	esac
}

write_du_cache() {
	local name="$1"
	local cache_file
	cache_file="$(cache_file_for "$name")"

	if [ -e "$cache_file" ]; then
		return 0
	fi

	local -a dirs=()
	while IFS= read -r -d '' dir; do
		dirs+=("$dir")
	done < <(find_named_dirs "$name")

	if [ "${#dirs[@]}" -eq 0 ]; then
		: >"$cache_file"
		return 0
	fi

	if ! timeout "${DU_TIMEOUT_SECONDS}s" du -sm "${dirs[@]}" >"$cache_file" 2>/dev/null; then
		printf '__TIMEOUT__\t%s\n' "$name" >"$cache_file"
	fi
}

sum_named_dirs_mb() {
	local name="$1"
	local cache_file
	write_du_cache "$name"
	cache_file="$(cache_file_for "$name")"
	if grep -q '^__TIMEOUT__' "$cache_file"; then
		echo -1
		return 0
	fi
	awk '{ total += $1 } END { print total + 0 }' "$cache_file"
}

top_named_dirs() {
	local name="$1"
	local limit="${2:-12}"
	local cache_file
	write_du_cache "$name"
	cache_file="$(cache_file_for "$name")"
	if grep -q '^__TIMEOUT__' "$cache_file"; then
		echo "  size scan timed out after ${DU_TIMEOUT_SECONDS}s"
		return 0
	fi
	sort -nr "$cache_file" |
		head -"$limit" |
		awk '{ size=$1; $1=""; sub(/^\t? */, ""); if (size >= 1024) printf "  %5.1fG  %s\n", size / 1024, $0; else printf "  %5dM  %s\n", size, $0 }'
}

print_class() {
	local name="$1"
	local mb
	mb="$(sum_named_dirs_mb "$name")"
	printf "  %-14s %8s\n" "$name" "$(human_mb "$mb")"
}

echo "Disk report for $REPO_ROOT"
echo ""
echo "Filesystem:"
df -h "$REPO_ROOT" 2>/dev/null | awk 'NR == 1 || NR == 2 { print "  " $0 }'
echo ""
echo "Derived artifact totals:"
print_class target
print_class node_modules
print_class dist
print_class .turbo
print_class coverage
print_class .artifacts
print_class artifacts
print_class .next
print_class .cache

echo ""
echo "Largest Rust target/ directories:"
top_named_dirs target 12

echo ""
echo "Largest node_modules/ directories:"
top_named_dirs node_modules 12

echo ""
echo "Largest dist/ directories:"
top_named_dirs dist 8

echo ""
echo "Guidance:"
echo "  npm run clean:light   # end-of-session: Rust incremental + .turbo"
echo "  npm run clean:medium  # plus coverage/artifacts"
echo "  npm run clean:heavy   # remove whole Rust target/ dirs; expensive rebuild"
