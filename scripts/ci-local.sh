#!/usr/bin/env bash
# scripts/ci-local.sh
#
# Local replica of the GitHub Actions "quality" job.
# Detects changed files (same patterns as test.yml) and runs only relevant checks.
#
# Usage:
#   ./scripts/ci-local.sh                    # auto-detect base (HEAD^)
#   ./scripts/ci-local.sh --base <sha>       # explicit base commit
#   ./scripts/ci-local.sh --full             # skip change detection, run everything
#   ./scripts/ci-local.sh --skip-turbo       # skip Turbo (quick mode)
#
# Skipped (require GH infra):
#   - Turbo remote cache (uses local .turbo instead)
#   - Artifact upload / PR comments
#   - GH_TOKEN / GITHUB_TOKEN API calls
#   - Task smoke tests (require running farmhand sidecar)
#   - Playwright E2E (require browsers)
#   - Tractor benchmark/coverage gates (require origin/main)

set -euo pipefail

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

step()  { echo -e "\n${BLUE}${BOLD}▶ $*${RESET}"; }
ok()    { echo -e "${GREEN}✓ $*${RESET}"; }
warn()  { echo -e "${YELLOW}⚠ $*${RESET}"; }
fail()  { echo -e "${RED}✗ $*${RESET}"; }
skip()  { echo -e "  ${YELLOW}⏭ skipped — $*${RESET}"; }

PASS=0; FAIL=0; SKIP=0
FAILED_STEPS=()

run_step() {
  local name="$1"; shift
  echo -e "\n  ${BOLD}→ ${name}${RESET}"
  if "$@"; then
    ok "$name"
    (( PASS++ )) || true
  else
    fail "$name"
    (( FAIL++ )) || true
    FAILED_STEPS+=("$name")
  fi
}

skip_step() {
  local name="$1"; shift
  skip "$name: $*"
  (( SKIP++ )) || true
}

# ── args ─────────────────────────────────────────────────────────────────────
BASE_SHA=""
FULL=false
SKIP_TURBO=false
LOCAL_TURBO_CACHE_DIR="${TURBO_CACHE_DIR:-.turbo}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)   BASE_SHA="$2"; shift 2 ;;
    --full)   FULL=true; shift ;;
    --skip-turbo) SKIP_TURBO=true; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── change detection (mirrors test.yml detect step) ──────────────────────────
step "Change Detection"

HEAD_SHA="$(git rev-parse HEAD)"

if [ "$FULL" = "true" ]; then
  warn "Running in --full mode, all checks enabled."
  ci_changes=true; code_changes=true; tractor_gates=true
  run_task_smoke=false; run_e2e=false; run_audit=true
  TURBO_FILTER=""
else
  if [ -z "$BASE_SHA" ]; then
    BASE_SHA="$(git rev-parse HEAD^ 2>/dev/null || echo "")"
  fi

  if [ -z "$BASE_SHA" ] || ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
    warn "Cannot resolve base SHA — treating everything as changed."
    ci_changes=true; code_changes=true; tractor_gates=true
    run_task_smoke=false; run_e2e=false; run_audit=true
    TURBO_FILTER=""
  else
    git diff --name-only "$BASE_SHA" "$HEAD_SHA" > /tmp/refarm-ci-local-changed.txt
    echo "Changed files (base=${BASE_SHA:0:8} → head=${HEAD_SHA:0:8}):"
    cat /tmp/refarm-ci-local-changed.txt | sed 's/^/  /' || true

    has_match() { grep -Eq "$1" /tmp/refarm-ci-local-changed.txt; }

    ci_changes=false
    has_match '^(\.github/workflows/|\.github/actions/)' && ci_changes=true

    code_changes=false
    has_match '^(apps/|packages/|validations/|templates/|scripts/|turbo\.json$|package\.json$|pnpm-lock\.yaml$|tsconfig\.json$)' && code_changes=true

    tractor_gates=false
    has_match '^(packages/tractor/|packages/tractor-ts/|packages/pi-agent/|packages/barn/|packages/plugin-manifest/|packages/storage-sqlite/|packages/storage-rest/|packages/sync-loro/|turbo\.json$|package\.json$|pnpm-lock\.yaml$)' && tractor_gates=true

    run_task_smoke=false  # always skip locally (needs farmhand sidecar)
    run_e2e=false         # always skip locally (needs Playwright browsers)
    run_audit=false
    [ "$code_changes" = "true" ] && run_audit=true

    TURBO_FILTER="...[$BASE_SHA]"
  fi
fi

echo ""
echo "  ci_changes=$ci_changes"
echo "  code_changes=$code_changes"
echo "  tractor_gates=$tractor_gates"
echo "  run_task_smoke=$run_task_smoke (always skipped — needs farmhand sidecar)"
echo "  run_e2e=$run_e2e (always skipped — needs Playwright)"
echo "  run_audit=$run_audit"
echo "  turbo_filter=${TURBO_FILTER:-<none>}"

# ── 1. Project block consistency (no pnpm needed) ────────────────────────────
step "Validate .project cross-block consistency"
run_step "project-block-consistency" node scripts/ci/project-block-consistency.mjs

# ── 1b. Missing dep declarations (catches pnpm hoisting gaps before Turbo) ───
step "Missing dependency declarations"
run_step "check-missing-deps" node scripts/check-missing-deps.mjs

# ── 2. pnpm install --frozen-lockfile (mirrors setup action) ─────────────────
step "Setup — pnpm install --frozen-lockfile"
if [ ! -f pnpm-lock.yaml ]; then
  fail "pnpm-lock.yaml is missing — CI would reject this."
  (( FAIL++ )) || true
  FAILED_STEPS+=("pnpm-lock.yaml exists")
else
  run_step "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile
fi

# ── 3. Security audit ────────────────────────────────────────────────────────
step "Security Audit"
if [ "$code_changes" = "true" ] || [ "$run_audit" = "true" ]; then
  run_step "pnpm audit --audit-level=high" pnpm audit --audit-level=high
else
  skip_step "pnpm audit" "no code changes"
fi

# ── 4. TSConfig preflight ────────────────────────────────────────────────────
step "TSConfig Preflight"
if [ "$code_changes" = "true" ]; then
  run_step "tsconfig:guard" node scripts/ci/run-root-scripts.mjs tsconfig:guard
else
  skip_step "tsconfig:guard" "no code changes"
fi

# ── 5. Carry-forward policy unit tests ───────────────────────────────────────
step "Carry-forward policy unit tests"
if [ "$ci_changes" = "true" ]; then
  run_step "test-carry-forward-status-lib" node --test scripts/ci/test-carry-forward-status-lib.mjs
else
  skip_step "test-carry-forward-status-lib" "no CI file changes"
fi

# ── 6. Task smoke tests ───────────────────────────────────────────────────────
step "Task Smoke Tests"
skip_step "task:execution:smoke" "requires farmhand sidecar (run manually if needed)"
skip_step "task:execution:smoke:pi-agent" "requires farmhand sidecar"
skip_step "refarm:telemetry:gate:ci" "requires farmhand sidecar"

# ── 7. Turbo: build lint type-check test ─────────────────────────────────────
step "Turbo: build lint type-check test"
if [ "$SKIP_TURBO" = "true" ]; then
  skip_step "pnpm turbo ..." "--skip-turbo flag set"
elif [ "$code_changes" = "true" ]; then
  if [ -n "$TURBO_FILTER" ]; then
    run_step "pnpm turbo (affected: $TURBO_FILTER)" \
      pnpm turbo run build lint type-check test:unit test:integration --filter="$TURBO_FILTER" --cache-dir="$LOCAL_TURBO_CACHE_DIR"
  else
    run_step "pnpm turbo (full fallback)" \
      pnpm turbo run build lint type-check test:unit test:integration --cache-dir="$LOCAL_TURBO_CACHE_DIR"
  fi
else
  skip_step "pnpm turbo" "no code changes"
fi

# ── 8. Tractor gates (skipped without origin/main) ───────────────────────────
step "Tractor Gates"
if [ "$tractor_gates" = "true" ]; then
  skip_step "Benchmark Quality Gate" "requires checkout of origin/main — run manually if needed"
  skip_step "Coverage Quality Gate" "requires coverage:save baseline — run manually if needed"
  echo "  → tractor health probe smoke (best-effort — requires compiled Rust binary)"
  if node scripts/ci/run-workspace-script.mjs packages/tractor test:smoke:health 2>&1; then
    ok "tractor:test:smoke:health"
    (( PASS++ )) || true
  else
    warn "tractor:test:smoke:health failed (non-fatal locally — binary may not be built)"
    (( SKIP++ )) || true
  fi
else
  skip_step "tractor gates" "no tractor-affecting changes"
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  CI Local — Summary${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}Passed: $PASS${RESET}"
echo -e "  ${YELLOW}Skipped: $SKIP${RESET}"
echo -e "  ${RED}Failed: $FAIL${RESET}"

if [ "${#FAILED_STEPS[@]}" -gt 0 ]; then
  echo ""
  echo -e "  ${RED}${BOLD}Failed steps:${RESET}"
  for s in "${FAILED_STEPS[@]}"; do
    echo -e "    ${RED}✗ $s${RESET}"
  done
fi

echo -e "${BOLD}═══════════════════════════════════════════════${RESET}"

if [ "$FAIL" -gt 0 ]; then
  echo -e "\n${RED}${BOLD}FAIL — fix the above before pushing.${RESET}\n"
  exit 1
else
  echo -e "\n${GREEN}${BOLD}PASS — safe to push.${RESET}\n"
fi
