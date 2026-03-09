#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';

function getArg(name, fallback = '') {
  const prefix = `${name}=`;
  const foundEq = process.argv.find((arg) => arg.startsWith(prefix));
  if (foundEq) {
    return foundEq.slice(prefix.length);
  }

  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }

  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function nowIso() {
  return new Date().toISOString();
}

function secondsSince(startNs) {
  const elapsedNs = process.hrtime.bigint() - startNs;
  return Number(elapsedNs / 1000000000n);
}

function runStep(name, cmd, env = {}) {
  const start = process.hrtime.bigint();
  try {
    execSync(cmd, {
      stdio: 'pipe',
      env: { ...process.env, ...env },
      maxBuffer: 10 * 1024 * 1024
    });
    return { name, seconds: secondsSince(start), status: 'pass' };
  } catch {
    return { name, seconds: secondsSince(start), status: 'fail' };
  }
}

function safeGit(cmd, fallback = 'unknown') {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString().trim() || fallback;
  } catch {
    return fallback;
  }
}

const outPath = getArg('--out', 'artifacts/perf/prepush-baseline.csv');
const includeAudit = !hasFlag('--skip-audit');
const source = getArg('--source', 'local-dev');
const strict = hasFlag('--strict');

const checks = [
  { name: 'lint', cmd: 'npm run lint --silent', env: { CI: '1' } },
  { name: 'type_check', cmd: 'npm run type-check --silent', env: { CI: '1' } },
  { name: 'unit_tests', cmd: 'npm run test:unit --silent' },
  { name: 'quality_gate', cmd: 'node packages/toolbox/src/quality-gate.mjs' }
];

if (includeAudit) {
  checks.push({ name: 'security_audit_high', cmd: 'npm audit --audit-level=high --silent' });
}

const meta = {
  timestamp_utc: nowIso(),
  source,
  git_sha: safeGit('git rev-parse --short HEAD'),
  git_branch: safeGit('git rev-parse --abbrev-ref HEAD'),
  os: safeGit('uname -s'),
  node: safeGit('node -v'),
  npm: safeGit('npm -v')
};

const results = checks.map((step) => runStep(step.name, step.cmd, step.env));
const totalSeconds = results.reduce((sum, r) => sum + r.seconds, 0);
const overallStatus = results.every((r) => r.status === 'pass') ? 'pass' : 'fail';

const header = [
  'timestamp_utc',
  'source',
  'git_sha',
  'git_branch',
  'os',
  'node',
  'npm',
  'lint_s',
  'lint_status',
  'type_check_s',
  'type_check_status',
  'unit_tests_s',
  'unit_tests_status',
  'quality_gate_s',
  'quality_gate_status',
  'security_audit_high_s',
  'security_audit_high_status',
  'total_s',
  'overall_status'
];

const byName = Object.fromEntries(results.map((r) => [r.name, r]));

const row = [
  meta.timestamp_utc,
  meta.source,
  meta.git_sha,
  meta.git_branch,
  meta.os,
  meta.node,
  meta.npm,
  byName.lint?.seconds ?? '',
  byName.lint?.status ?? '',
  byName.type_check?.seconds ?? '',
  byName.type_check?.status ?? '',
  byName.unit_tests?.seconds ?? '',
  byName.unit_tests?.status ?? '',
  byName.quality_gate?.seconds ?? '',
  byName.quality_gate?.status ?? '',
  byName.security_audit_high?.seconds ?? '',
  byName.security_audit_high?.status ?? '',
  totalSeconds,
  overallStatus
].join(',');

const absOutPath = resolve(outPath);
const outDir = dirname(absOutPath);
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

if (!existsSync(absOutPath)) {
  writeFileSync(absOutPath, `${header.join(',')}\n`, 'utf8');
}
appendFileSync(absOutPath, `${row}\n`, 'utf8');

console.log(`Baseline row appended to ${absOutPath}`);
console.log(row);

if (strict && overallStatus !== 'pass') {
  process.exitCode = 1;
}
