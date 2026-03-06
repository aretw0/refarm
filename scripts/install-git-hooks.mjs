#!/usr/bin/env node
/**
 * Install Git Hooks
 *
 * This script installs a pre-push hook that validates code quality before allowing pushes.
 * The hook runs lint, type-check, unit tests, and security audit.
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

echo "🔍 Running pre-push validation..."
echo ""

# Track failures
FAILED=0

# 1. Lint
echo "📝 Checking lint..."
if npm run lint --silent; then
  echo "   ✅ Lint passed"
else
  echo "   ❌ Lint failed! Fix issues before pushing."
  FAILED=1
fi
echo ""

# 2. Type-check
echo "🔤 Checking types..."
if npm run type-check --silent; then
  echo "   ✅ Type check passed"
else
  echo "   ❌ Type check failed! Fix type errors before pushing."
  FAILED=1
fi
echo ""

# 3. Unit tests
echo "🧪 Running unit tests..."
if npm run test:unit --silent; then
  echo "   ✅ Unit tests passed"
else
  echo "   ❌ Tests failed! Fix failing tests before pushing."
  FAILED=1
fi
echo ""

# 4. Security audit (high/critical only)
echo "🔒 Checking security..."
if npm audit --audit-level=high --silent; then
  echo "   ✅ No high/critical vulnerabilities"
else
  echo "   ⚠️  Security vulnerabilities detected!"
  echo "   Run 'npm audit fix' or document in docs/DEVOPS.md"
  FAILED=1
fi
echo ""

# Summary
if [ $FAILED -eq 1 ]; then
  echo "❌ Pre-push validation failed!"
  echo "   Fix the issues above before pushing."
  exit 1
fi

echo "✅ All pre-push checks passed!"
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
  console.log('The hook will run automatically before every push and validate:');
  console.log('  - Lint (code style)');
  console.log('  - Type-check (TypeScript)');
  console.log('  - Unit tests (functionality)');
  console.log('  - Security audit (vulnerabilities)');
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
