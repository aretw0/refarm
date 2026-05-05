#!/usr/bin/env node
/**
 * agent-stop — stop a backgrounded tractor daemon
 *
 * Reads .refarm/tractor.pid and sends SIGTERM.
 * Usage: npm run agent:stop
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PID_FILE = join(ROOT, '.refarm', 'tractor.pid');

const c = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', yellow: '\x1b[33m' };

if (!existsSync(PID_FILE)) {
  console.log(`${c.dim}No daemon PID file found — daemon may not be running.${c.reset}`);
  process.exit(0);
}

const raw = readFileSync(PID_FILE, 'utf8').trim();
const pid = parseInt(raw, 10);

if (isNaN(pid) || pid <= 0) {
  console.log(`${c.red}Invalid PID in ${PID_FILE}: "${raw}"${c.reset}`);
  unlinkSync(PID_FILE);
  process.exit(1);
}

try {
  process.kill(pid, 0); // Check the process is alive
} catch {
  console.log(`${c.yellow}Daemon (pid ${pid}) is not running. Cleaning up PID file.${c.reset}`);
  unlinkSync(PID_FILE);
  process.exit(0);
}

try {
  process.kill(pid, 'SIGTERM');
  unlinkSync(PID_FILE);
  console.log(`${c.green}Daemon stopped (pid ${pid}).${c.reset}`);
} catch (e) {
  console.error(`${c.red}Failed to stop daemon (pid ${pid}): ${e.message}${c.reset}`);
  process.exit(1);
}
