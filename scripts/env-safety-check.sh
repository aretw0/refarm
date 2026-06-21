#!/usr/bin/env bash
set -euo pipefail

non_fatal=0
auto_repair=0

usage() {
	cat <<'EOF'
Usage: scripts/env-safety-check.sh [--warn|--strict] [--repair]

Performs a small environment sanity sweep to avoid cross-OS checkout contamination
(e.g. host/Windows-linked node_modules inside a Linux devcontainer).

Options:
  --warn      Convert all violations to warnings (exit code 0).
  --strict    Exit non-zero on problems (default).
  --repair    Attempt safe repairs (currently: ownership remediation for node_modules trees).
  -h, --help Show this help text.
EOF
}

while [ "$#" -gt 0 ]; do
	case "$1" in
	--)
		shift
		continue
		;;
	--warn)
		non_fatal=1
		;;
	--strict)
		non_fatal=0
		;;
	--repair)
		auto_repair=1
		;;
	-h | --help)
		usage
		exit 0
		;;
	esac
	shift
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CURRENT_UID="$(id -u)"
CURRENT_GID="$(id -g)"
CURRENT_USER="$(id -un)"
ERRORS=0
WARNS=0

record_issue() {
	local level="$1"
	local message="$2"
	if [ "$level" = "error" ]; then
		echo "[refarm-env-check][error] $message"
		ERRORS=$((ERRORS + 1))
	else
		echo "[refarm-env-check][warn] $message"
		WARNS=$((WARNS + 1))
	fi
}

collect_node_modules_dirs() {
	# shellcheck disable=SC2016
	find "$ROOT" \
		\( -path "*/.git" -o -path "*/.git/*" -o -path "*/node_modules/.pnpm*" \) -prune -o \
		-type d -name node_modules -print0
}

check_mount_and_location() {
	echo "[refarm-env-check] root: $ROOT"
	if [ -f /.dockerenv ]; then
		echo "[refarm-env-check] runtime: container (/.dockerenv)"
	else
		echo "[refarm-env-check] runtime: host-like shell"
	fi

	if [ -f /.dockerenv ] && [[ "$ROOT" != /workspaces/* ]]; then
		record_issue error "Container checkout should live under /workspaces/, got: $ROOT"
	fi

	if [[ "$ROOT" == /mnt/* || "$ROOT" == /c/* || "$ROOT" == /d/* || "$ROOT" == /e/* ]]; then
		record_issue error "Root path looks like a host-mounted Windows-style path: $ROOT"
	fi
}

is_cross_so_target() {
	local path="$1"
	case "$path" in
	/mnt/host/*) return 0 ;;
	*:[\\/]*) return 0 ;;
	*) return 1 ;;
	esac
}

is_suspect_external() {
	local resolved="$1"

	if [[ "$resolved" == "$ROOT/"* ]]; then
		return 1
	fi
	if [[ "$resolved" == "$ROOT/node_modules/.pnpm"* || "$resolved" == "$ROOT/node_modules/.ignored_"* ]]; then
		return 1
	fi
	if [[ "$resolved" == "${HOME}"* ]]; then
		return 1
	fi
	return 0
}

check_owner() {
	local dir="$1"
	local owner_uid
	owner_uid="$(stat -c '%u' "$dir")"

	if [ "$owner_uid" -ne "$CURRENT_UID" ]; then
		record_issue error "Owner mismatch on $dir (uid=$owner_uid, current=$CURRENT_UID)."
		if [ "$auto_repair" -eq 1 ] && command -v sudo >/dev/null 2>&1; then
			sudo chown -R "$CURRENT_USER:$CURRENT_GID" "$dir" || true
			record_issue warn "Attempted chown on $dir"
		fi
	fi
}

check_symlink_targets() {
	local link="$1"
	local resolved

	if [ ! -e "$link" ]; then
		record_issue error "Broken symlink: $link"
		return
	fi

	resolved="$(readlink -f "$link")"
	if is_cross_so_target "$resolved"; then
		record_issue error "Cross-SO absolute target in symlink: $link -> $resolved"
		return
	fi

	if is_suspect_external "$resolved"; then
		record_issue warn "Symlink resolves outside repository: $link -> $resolved"
	fi
}

scan_node_modules() {
	local nm="${1%/}"
	if [ ! -d "$nm" ]; then
		return
	fi

	check_owner "$nm"

	while IFS= read -r -d '' link; do
		check_symlink_targets "$link"
	done < <(find "$nm" -type l -print0)
}

check_mount_and_location

node_modules_dirs=()
while IFS= read -r -d '' dir; do
	node_modules_dirs+=("$dir")
done < <(collect_node_modules_dirs)

for nm in "${node_modules_dirs[@]}"; do
	scan_node_modules "$nm"
done

if [ "${ERRORS}" -gt 0 ]; then
	echo "[refarm-env-check] status: FAIL (errors=$ERRORS, warnings=$WARNS)"
	if [ "$auto_repair" -eq 1 ]; then
		echo "[refarm-env-check] Some issues were remediated with --repair where possible."
	fi
	echo "[refarm-env-check] Suggested recovery: do not mix host+container checkouts for the same workspace; rebuild node_modules in a single runtime."
	if [ "$non_fatal" -eq 1 ]; then
		exit 0
	fi
	exit 1
fi

echo "[refarm-env-check] status: OK (errors=$ERRORS, warnings=$WARNS)"
exit 0
