#!/usr/bin/env node
/**
 * Install Git Hooks
 *
 * This script installs a pre-push hook with branch-aware strictness.
 *
 * Local policy:
 *   - main/develop: blocking checks for lint + type-check
 *   - feature branches: warning-only mode
 *   - test:unit and security are advisory locally (enforced in CI)
 *
 * Usage: npm run hooks:install
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const hookContent = `#!/bin/sh
# Pre-push hook: valida qualidade antes de push
# Installed by: npm run hooks:install
# Mode: context-aware (strict on main/develop, permissive on other branches)

# Helper function to filter Vite CJS deprecation warnings
# (informational only, not a functional issue)
filter_vite_warning() {
  grep -v "The CJS build of Vite's Node API is deprecated" | grep -v "vite.dev/guide/troubleshooting"
}

echo "🔍 Running pre-push validation..."
echo ""

# Determine current branch
CURRENT_BRANCH=\$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
echo "📌 Current branch: \$CURRENT_BRANCH"
echo ""

# Check if we are in a protected branch (main or develop)
IS_PROTECTED_BRANCH=0
case "\$CURRENT_BRANCH" in
  main|develop)
    IS_PROTECTED_BRANCH=1
    echo "🔒 STRICT mode activated (protected branch)"
    ;;
  *)
    echo "⚠️  PERMISSIVE mode activated (feature branch)"
    ;;
esac
echo ""

# Track outcomes
BLOCKING_FAILED=0
WARNINGS=0

# 1. Lint
echo "📝 Checking lint..."
if CI=1 npm run lint --silent 2>&1 | filter_vite_warning >/dev/null; then
  echo "   ✅ Lint passed"
else
  if [ \$IS_PROTECTED_BRANCH -eq 1 ]; then
    echo "   ❌ Lint failed (blocking in strict mode)"
    BLOCKING_FAILED=1
  else
    echo "   ⚠️  Lint failed (warning in permissive mode)"
    WARNINGS=1
  fi
fi
echo ""

# 2. Type-check
echo "🔤 Checking types..."
TYPECHECK_OUTPUT=$(CI=1 npm run type-check --silent 2>&1 | filter_vite_warning)
TYPECHECK_STATUS=$?
if [ \$TYPECHECK_STATUS -eq 0 ]; then
  echo "   ✅ Type-check passed"
else
  if echo "\$TYPECHECK_OUTPUT" | grep -q "Could not find task"; then
    echo "   ⚠️  Type-check task missing in some workspaces (warning)"
    WARNINGS=1
  else
    if [ \$IS_PROTECTED_BRANCH -eq 1 ]; then
      echo "   ❌ Type-check failed (blocking in strict mode)"
      BLOCKING_FAILED=1
    else
      echo "   ⚠️  Type-check failed (warning in permissive mode)"
      WARNINGS=1
    fi
  fi
fi
echo ""

# 3. Unit tests
echo "🧪 Running unit tests (advisory local check)..."
if npm run test:unit --silent 2>&1 | filter_vite_warning >/dev/null; then
  echo "   ✅ Unit tests passed"
else
  echo "   ⚠️  Unit tests failed (non-blocking local warning)"
  WARNINGS=1
fi
echo ""

# 4. Quality Gate (SDD->BDD->TDD->DDD)
echo "🔍 Checking Refarm Quality Gate..."
node packages/toolbox/src/quality-gate.mjs || {
  if [ "\$IS_PROTECTED_BRANCH" -eq 1 ]; then
    echo "❌ Quality Gate failed (blocking in strict mode)."
    exit 1
  fi
  echo "⚠️ Quality Gate failed (warning in permissive mode)."
  WARNINGS=1
}
echo ""

# 5. Security audit (high/critical only)
echo "🔒 Checking security (advisory local check)..."
if npm audit --audit-level=high --silent 2>/dev/null; then
  echo "   ✅ No high/critical vulnerabilities"
else
  echo "   ⚠️  Security check returned issues (non-blocking local warning)"
  WARNINGS=1
fi
echo ""

# Summary and decision
if [ \$IS_PROTECTED_BRANCH -eq 1 ] && [ \$BLOCKING_FAILED -eq 1 ]; then
  echo "❌ Pre-push validation failed (STRICT mode)!"
  echo "   Protected branch (\$CURRENT_BRANCH) blocks on lint/type-check failures."
  exit 1
fi

if [ \$WARNINGS -eq 1 ]; then
  echo "⚠️  Push allowed with warnings"
  echo "   CI remains the final gate for tests/security/build"
else
  echo "✅ Local checks passed"
fi

echo "🚀 Push allowed"
exit 0
`;

const postCheckoutHookContent = `#!/bin/sh
# Post-checkout hook: warns/generates tractor baselines when switching branches
# Installed by: npm run hooks:install

# Keep branch changes non-blocking even when optional baselines are not implemented yet.
cleanup_transient_artifacts() {
  rm -f benchmarks/gha-payload.json coverage/gha-payload.json
}

has_npm_script() {
  script_name="$1"
  node -e 'const fs = require("fs"); const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1)' "$script_name"
}

try_generate_baseline() {
  target_file="$1"
  script_name="$2"
  missing_message="$3"
  success_message="$4"

  if [ -f "$target_file" ]; then
    echo "$success_message"
    return 0
  fi

  echo "$missing_message"

  if ! has_npm_script "$script_name"; then
    echo "⚠️  Script '$script_name' is unavailable for this package. Skipping."
    cleanup_transient_artifacts
    return 0
  fi

  if npm run "$script_name"; then
    if [ -f "$target_file" ]; then
      echo "✅ Baseline generated: $target_file"
    else
      echo "⚠️  Script '$script_name' did not produce $target_file. Skipping for this package."
      cleanup_transient_artifacts
    fi
  else
    echo "⚠️  Script '$script_name' is unavailable or failed. Skipping for this package."
    cleanup_transient_artifacts
  fi
}

# Only trigger when switching branches, not when checking out files
if [ "$3" = "1" ]; then
  echo "🌱 [Refarm] Branch changed. Validating Tractor Baselines..."
  cd packages/tractor || exit 0

  try_generate_baseline \
    "benchmarks/baseline.json" \
    "bench:save" \
    "⚠️  No benchmark baseline found. Generating one now..." \
    "✅ Benchmark baseline present. (Run 'npm run bench:save' manually to refresh)"

  try_generate_baseline \
    "benchmarks/coverage-baseline.json" \
    "coverage:save" \
    "⚠️  No coverage baseline found. Generating one now..." \
    "✅ Coverage baseline present. (Run 'npm run coverage:save' manually to refresh)"
fi
`;

const hooksDir = join(rootDir, '.git', 'hooks');
const prePushPath = join(hooksDir, 'pre-push');
const postCheckoutPath = join(hooksDir, 'post-checkout');

try {
  // Ensure .git/hooks directory exists
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  // Write hook files
  writeFileSync(prePushPath, hookContent, 'utf8');
  writeFileSync(postCheckoutPath, postCheckoutHookContent, 'utf8');

  // Make executable (chmod +x)
  chmodSync(prePushPath, 0o755);
  chmodSync(postCheckoutPath, 0o755);

  console.log('✅ Git hooks (pre-push, post-checkout) installed successfully!');
  console.log('');
  console.log('The pre-push hook runs automatically before every push with context-aware behavior:');
  console.log('');
  console.log('📌 STRICT mode (on main/develop):');
  console.log('  - Blocks push on lint + type-check failures');
  console.log('  - Unit/security are advisory locally');
  console.log('  - CI remains the final enforcement gate');
  console.log('');
  console.log('⚠️  PERMISSIVE mode (on feature branches):');
  console.log('  - Non-blocking local warnings only');
  console.log('  - CI/CD validates full gates on server');
  console.log('');
  console.log('The post-checkout hook ensures developers generate benchmark baselines when switching branches.');
  console.log('');
  console.log('To bypass the hook (not recommended):');
  console.log('  git push --no-verify');
} catch (error) {
  console.error('❌ Failed to install git hooks:', error.message);
  console.error('');
  console.error('This might happen if:');
  console.error('  - Not in a git repository');
  console.error('  - Insufficient permissions');
  console.error('  - .git directory is corrupted');
  process.exit(1);
}
