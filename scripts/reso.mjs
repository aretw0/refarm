#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

/**
 * DEPRECATED: This script is now part of @refarm.dev/toolbox.
 * It remains here as a wrapper for backward compatibility.
 */

const mode = process.argv[2] || 'status';

// Try to run via pnpm/npm exec if possible, or direct node call to toolbox
const result = spawnSync('node', ['./packages/toolbox/src/cli.mjs', 'reso', mode], {
  stdio: 'inherit',
  shell: true
});

process.exit(result.status);
