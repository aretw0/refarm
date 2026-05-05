#!/usr/bin/env node
/**
 * farm-status — unified process and health status for the Refarm factory.
 *
 * Covers tractor (Rust WASM host) and farmhand (Node.js task orchestrator).
 * Run: npm run farm:status
 * See: docs/PROCESS_PLAYBOOK.md
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const c = {
  reset:  '\x1b[0m', bold:  '\x1b[1m', dim:   '\x1b[2m',
  green:  '\x1b[32m', red:  '\x1b[31m', yellow: '\x1b[33m',
  cyan:   '\x1b[36m', blue: '\x1b[34m',
};

function ok(label, msg)   { console.log(`  ${c.green}[+]${c.reset} ${c.bold}${label.padEnd(14)}${c.reset} ${msg}`); }
function warn(label, msg) { console.log(`  ${c.yellow}[!]${c.reset} ${c.bold}${label.padEnd(14)}${c.reset} ${c.yellow}${msg}${c.reset}`); }
function fail(label, msg) { console.log(`  ${c.red}[x]${c.reset} ${c.bold}${label.padEnd(14)}${c.reset} ${c.red}${msg}${c.reset}`); }
function info(label, msg) { console.log(`  ${c.dim}[o]${c.reset} ${c.bold}${label.padEnd(14)}${c.reset} ${c.dim}${msg}${c.reset}`); }
function section(name)    { console.log(`\n${c.bold}${name}${c.reset}`); }

// ── helpers ───────────────────────────────────────────────────────────────────

function fileAge(path) {
  const mins = Math.floor((Date.now() - statSync(path).mtime.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function fileSize(path) {
  const b = statSync(path).size;
  return b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.round(b / 1024)}KB`;
}

function readPid(file) {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, 'utf8').trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) || pid <= 0 ? null : pid;
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    vars[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return vars;
}

function maskedKey(k) {
  if (!k || k.length < 12) return '(empty)';
  return k.slice(0, 8) + '…' + k.slice(-4);
}

// ── port detection ────────────────────────────────────────────────────────────

function portBinding(port) {
  const r = spawnSync('ss', ['-tlnp'], { encoding: 'utf8', timeout: 2000 });
  if (r.status !== 0 || !r.stdout) return { bound: false };

  const line = r.stdout.split('\n').find(l => {
    return l.includes(`:${port} `) || l.includes(`:${port}\t`) || l.endsWith(`:${port}`);
  });
  if (!line) return { bound: false };

  const pidMatch = line.match(/pid=(\d+)/);
  const progMatch = line.match(/"([^"]+)"/);
  return {
    bound: true,
    pid:   pidMatch?.[1] ? parseInt(pidMatch[1], 10) : null,
    proc:  progMatch?.[1] ?? null,
  };
}

// ── HTTP probe ────────────────────────────────────────────────────────────────

async function httpProbe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── tractor WS probe ──────────────────────────────────────────────────────────

function tractorWsProbe(port) {
  const _cargoTarget = process.env.CARGO_TARGET_DIR;
  const bin = _cargoTarget
    ? join(_cargoTarget, 'release/tractor')
    : join(ROOT, 'packages/tractor/target/release/tractor');
  if (!existsSync(bin)) return { ok: false, reason: 'binary not found' };
  const r = spawnSync(bin, ['health', '--ws-port', String(port), '--skip-boot-probe'], {
    encoding: 'utf8', timeout: 3000,
  });
  return r.status === 0 ? { ok: true } : { ok: false, reason: r.stderr?.trim() ?? `exit ${r.status}` };
}

// ── artifact paths ────────────────────────────────────────────────────────────

function artifactPaths() {
  const t = process.env.CARGO_TARGET_DIR;
  return {
    tractor: t
      ? join(t, 'release/tractor')
      : join(ROOT, 'packages/tractor/target/release/tractor'),
    wasm: t
      ? join(t, 'wasm32-wasip1/release/pi_agent.wasm')
      : join(ROOT, 'packages/pi-agent/target/wasm32-wasip1/release/pi_agent.wasm'),
  };
}

// ── checks ────────────────────────────────────────────────────────────────────

function checkTractor() {
  const pidFile = join(ROOT, '.refarm', 'tractor.pid');
  const pid = readPid(pidFile);

  if (!pid || !isAlive(pid)) {
    const b42 = portBinding(42000);
    if (b42.bound) {
      warn('tractor', `no PID file but port 42000 bound by PID ${b42.pid ?? '?'} (${b42.proc ?? 'unknown'}) — stale?`);
    } else {
      info('tractor', `not running  ${c.dim}(start: npm run agent:daemon)${c.reset}`);
    }
    return false;
  }

  const ws = tractorWsProbe(42000);
  if (ws.ok) {
    ok('tractor', `pid=${pid}  ws://127.0.0.1:42000  ${c.green}WS responding${c.reset}`);
  } else {
    warn('tractor', `pid=${pid} alive but WS not responding (${ws.reason})`);
  }
  return true;
}

async function checkFarmhand() {
  const pidFile = join(ROOT, '.refarm', 'farmhand.pid');
  const pid = readPid(pidFile);

  if (!pid || !isAlive(pid)) {
    const b42 = portBinding(42000);
    const b01 = portBinding(42001);
    if (b01.bound) {
      warn('farmhand', `no PID file but port 42001 bound by PID ${b01.pid ?? '?'} (${b01.proc ?? 'unknown'}) — CI stub running?`);
    } else if (b42.bound) {
      info('farmhand', `not running  (port 42000 held by ${b42.proc ?? 'pid=' + b42.pid})`);
    } else {
      info('farmhand', `not running  ${c.dim}(start: npm run farmhand:daemon)${c.reset}`);
    }
    return false;
  }

  const summary = await httpProbe('http://127.0.0.1:42001/efforts/summary');
  if (summary) {
    const { total = 0, active = 0, done = 0, failed = 0 } = summary;
    ok('farmhand', `pid=${pid}  http://127.0.0.1:42001  tasks: ${active} active / ${done} done / ${failed} failed / ${total} total`);
  } else {
    warn('farmhand', `pid=${pid} alive but HTTP sidecar not responding on :42001`);
  }
  return true;
}

function checkPorts() {
  for (const [port, role] of [[42000, 'ws-crdt'], [42001, 'http-sidecar']]) {
    const b = portBinding(port);
    if (b.bound) {
      ok(`:${port}`, `${b.proc ?? '?'} (pid ${b.pid ?? '?'}) — ${role}`);
    } else {
      info(`:${port}`, `unbound  (${role})`);
    }
  }
}

function checkArtifacts() {
  const { tractor, wasm } = artifactPaths();

  if (existsSync(tractor)) {
    ok('tractor-bin', `${fileSize(tractor)}  built ${fileAge(tractor)}`);
  } else {
    fail('tractor-bin', `not found — build: cd packages/tractor && cargo build --release`);
  }

  if (existsSync(wasm)) {
    ok('pi_agent.wasm', `${fileSize(wasm)}  built ${fileAge(wasm)}`);
  } else {
    fail('pi_agent.wasm', `not found — build: cd packages/pi-agent && cargo component build --release`);
  }

  const cargoTarget = process.env.CARGO_TARGET_DIR;
  if (cargoTarget) {
    info('cargo-target', `${cargoTarget}  ${c.dim}(Docker volume — off host C:\\)${c.reset}`);
  }
}

function checkLlm() {
  const envFile = join(ROOT, '.refarm', '.env');
  const configFile = join(ROOT, '.refarm', 'config.json');

  const envVars = readEnvFile(envFile);
  let config = {};
  try { config = JSON.parse(readFileSync(configFile, 'utf8')); } catch { /* ok */ }

  const KEY_LABELS = {
    ANTHROPIC_API_KEY:  'Anthropic', OPENAI_API_KEY: 'OpenAI',
    GROQ_API_KEY:       'Groq',      MISTRAL_API_KEY: 'Mistral',
    XAI_API_KEY:        'xAI',       DEEPSEEK_API_KEY: 'DeepSeek',
    TOGETHER_API_KEY:   'Together',  OPENROUTER_API_KEY: 'OpenRouter',
    GEMINI_API_KEY:     'Gemini',
  };

  const configured = Object.entries(KEY_LABELS)
    .filter(([k]) => envVars[k] || process.env[k])
    .map(([k, label]) => `${label} ${c.dim}${maskedKey(envVars[k] || process.env[k])}${c.reset}`);

  if (configured.length) ok('keys', configured.join('  '));
  else fail('keys', 'no API keys — run: npm run agent:keys');

  const provider = envVars.LLM_PROVIDER || process.env.LLM_PROVIDER || config.provider || 'ollama';
  const model    = envVars.LLM_MODEL    || process.env.LLM_MODEL    || config.model    || '(default)';
  const budget   = config.budgets?.[provider] ?? null;
  info('llm', [
    `provider=${c.cyan}${provider}${c.reset}`,
    `model=${c.dim}${model}${c.reset}`,
    budget ? `budget=${c.dim}$${budget}/30d${c.reset}` : null,
  ].filter(Boolean).join('  '));
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const time = new Date().toLocaleTimeString();
  console.log(`\n${c.bold}farm status${c.reset}  ${c.dim}${time}${c.reset}  ${c.dim}(see docs/PROCESS_PLAYBOOK.md)${c.reset}`);

  section('SERVICES');
  const tractorUp = checkTractor();
  const farmhandUp = await checkFarmhand();

  if (tractorUp && farmhandUp) {
    warn('conflict!', 'tractor and farmhand both running — they share port 42000. Stop one. See PROCESS_PLAYBOOK.md.');
  }

  section('PORTS');
  checkPorts();

  if (farmhandUp) {
    section('TASK QUEUE');
    const summary = await httpProbe('http://127.0.0.1:42001/efforts/summary');
    if (summary) {
      const { active = 0, pending = 0, done = 0, failed = 0, total = 0 } = summary;
      if (active > 0) ok('active', `${active} effort(s) in progress`);
      else            info('active', 'none');
      if (pending > 0) warn('pending', `${pending} effort(s) waiting`);
      if (failed > 0)  fail('failed', `${failed} effort(s) failed — check .refarm/task-results/`);
      info('totals', `${done} done  ${failed} failed  ${total} total`);
    }
  }

  section('ARTIFACTS');
  checkArtifacts();

  section('LLM');
  checkLlm();

  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
