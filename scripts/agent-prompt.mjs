#!/usr/bin/env node
/**
 * agent-prompt — one-shot prompt against the tractor agent.
 *
 * Thin wrapper so the package script survives target-dir moves: the binary
 * location comes from the shared cargo-target resolver, never a literal path.
 * Extra CLI args pass through (e.g. `pnpm run agent:prompt -- "hello"`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tractorBinaryPath } from './lib/cargo-target.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const TRACTOR = tractorBinaryPath(ROOT);

if (!existsSync(TRACTOR)) {
  console.error(`tractor binary not found at ${TRACTOR}`);
  console.error('Build it with: pnpm -C packages/tractor run build');
  process.exit(1);
}

const result = spawnSync(TRACTOR, ['prompt', '--agent', 'agent', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
