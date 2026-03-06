#!/usr/bin/env node
/**
 * Install Git Hooks
 *
 * This script installs a pre-push hook that validates code quality before allowing pushes.
 * The hook is context-aware:
 *   - STRICT mode: on main/develop (blocks push on any failure)
 *   - PERMISSIVE mode: on all other branches (warns but allows push)
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

# Track failures (only matters in strict mode)
FAILED=0

# 1. Lint
echo "📝 Checking lint..."
if npm run lint --silent 2>/dev/null; then
  echo "   ✅ Lint passed"
else
  echo "   ❌ Lint failed"
  FAILED=1
fi
echo ""

# 2. Type-check
echo "🔤 Checking types..."
if npm run type-check --silent 2>/dev/null; then
  echo "   ✅ Type check passed"
else
  echo "   ❌ Type check failed"
  FAILED=1
fi
echo ""

# 3. Unit tests
echo "🧪 Running unit tests..."
if npm run test:unit --silent 2>/dev/null; then
  echo "   ✅ Unit tests passed"
else
  echo "   ❌ Tests failed"
  FAILED=1
fi
echo ""

# 4. Security audit (high/critical only)
echo "🔒 Checking security..."
if npm audit --audit-level=high --silent 2>/dev/null; then
  echo "   ✅ No high/critical vulnerabilities"
else
  echo "   ⚠️  Security vulnerabilities detected"
  FAILED=1
fi
echo ""

# Summary and decision
if [ \$FAILED -eq 1 ]; then
  if [ \$IS_PROTECTED_BRANCH -eq 1 ]; then
    echo "❌ Pre-push validation failed (STRICT mode)!"
    echo "   Protected branch (\$CURRENT_BRANCH) requires all checks to pass."
    echo "   Fix the issues above before pushing."
    exit 1
  else
    echo "⚠️  Pre-push validation issued warnings (PERMISSIVE mode)"
    echo "   Feature branch (\$CURRENT_BRANCH) will allow push with warnings."
    echo "   To fix: address issues and run checks before opening PR."
    echo ""
    read -p "   Continue pushing anyway? [y/N] " -r
    echo ""
    if [[ ! \$REPLY =~ ^[Yy]$ ]]; then
      echo "   Push cancelled by user."
      exit 1
    fi
    echo "   Proceeding with push (CI/CD will validate on server)..."
  fi
fi

echo "✅ Pre-push validation passed!"
echo "   Safe to push."
exit 0
`;

const hooksDir = join(rootDir, '.git', 'hooks');
const hookPath = join(hooksDir, 'pre-push');

try {
  // Ensure .git/hooks directory exists
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  // Write hook file
  writeFileSync(hookPath, hookContent, 'utf8');

  // Make executable (chmod +x)
  chmodSync(hookPath, 0o755);

  console.log('✅ Git pre-push hook installed successfully!');
  console.log('');
  console.log('The hook runs automatically before every push with context-aware behavior:');
  console.log('');
  console.log('📌 STRICT mode (on main/develop):');
  console.log('  - Validates: lint → type-check → unit tests → security');
  console.log('  - Blocks push if any check fails');
  console.log('  - Ensures code quality in protected branches');
  console.log('');
  console.log('⚠️  PERMISSIVE mode (on feature branches):');
  console.log('  - Same validation checks, but non-blocking');
  console.log('  - Warns but allows push (CI/CD validates on server)');
  console.log('  - Prompt enables aborting if issues found');
  console.log('');
  console.log('To bypass the hook (not recommended):');
  console.log('  git push --no-verify');
} catch (error) {
  console.error('❌ Failed to install pre-push hook:', error.message);
  console.error('');
  console.error('This might happen if:');
  console.error('  - Not in a git repository');
  console.error('  - Insufficient permissions');
  console.error('  - .git directory is corrupted');
  process.exit(1);
}
