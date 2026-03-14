#!/usr/bin/env node

/**
 * toggle-dev-mode.mjs
 * 
 * Helps toggle VITEST_USE_DIST and explains current configuration.
 */

import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const useDist = process.env.VITEST_USE_DIST === 'true';

console.log(`\n🚀 Refarm Dev Mode Utility`);
console.log(`-------------------------`);
console.log(`Current Mode: ${useDist ? '📦 DIST (Testing built artifacts)' : '🧪 SOURCE (Testing local src/*.ts)'}`);
console.log(`-------------------------\n`);

if (args.length === 0) {
  console.log(`Usage:`);
  console.log(`  node scripts/toggle-dev-mode.mjs test      - Run tests in current mode`);
  console.log(`  VITEST_USE_DIST=true node ... test       - Run tests in DIST mode`);
  console.log(`\nExample:`);
  console.log(`  VITEST_USE_DIST=true npm test\n`);
} else if (args[0] === 'test') {
  console.log(`Running tests...`);
  try {
    execSync('npm test', { stdio: 'inherit' });
  } catch (e) {
    process.exit(1);
  }
}
