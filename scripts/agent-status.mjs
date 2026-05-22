#!/usr/bin/env node
/**
 * agent-status — health check for the pi-agent stack
 *
 * Shows: daemon state, configured keys, WASM freshness, model config, MODEL_FS_ROOT safety.
 * Usage: run the agent:status package script with the configured package manager.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import os from 'node:os';
import {
  DEFAULT_MODEL_PROVIDER,
  defaultModelForProvider,
  modelCredentialStatus,
} from '../packages/config/src/model-routing.js';
import { packageScriptCommand } from '../packages/config/src/package-manager.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const PID_FILE   = join(ROOT, '.refarm', 'tractor.pid');
const ENV_FILE   = join(ROOT, '.refarm', '.env');
const CONFIG_FILE = join(ROOT, '.refarm', 'config.json');
const _cargoTarget = process.env.CARGO_TARGET_DIR;
const TRACTOR    = _cargoTarget
  ? join(_cargoTarget, 'release/tractor')
  : join(ROOT, 'packages/tractor/target/release/tractor');
const PI_AGENT   = _cargoTarget
  ? join(_cargoTarget, 'wasm32-wasip1/release/pi_agent.wasm')
  : join(ROOT, 'packages/pi-agent/target/wasm32-wasip1/release/pi_agent.wasm');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

// ── helpers ───────────────────────────────────────────────────────────────────

function ok(label, msg)   { console.log(`  ${c.green}[+]${c.reset} ${c.bold}${label.padEnd(12)}${c.reset} ${msg}`); }
function warn(label, msg) { console.log(`  ${c.yellow}[!]${c.reset} ${c.bold}${label.padEnd(12)}${c.reset} ${c.yellow}${msg}${c.reset}`); }
function fail(label, msg) { console.log(`  ${c.red}[x]${c.reset} ${c.bold}${label.padEnd(12)}${c.reset} ${c.red}${msg}${c.reset}`); }
function info(label, msg) { console.log(`  ${c.dim}[o]${c.reset} ${c.bold}${label.padEnd(12)}${c.reset} ${c.dim}${msg}${c.reset}`); }
function scriptCommand(script) { return packageScriptCommand(script, { cwd: ROOT }).display; }

function readEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const vars = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    vars[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return vars;
}

function readConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

function maskedKey(k) {
  if (!k || k.length < 12) return '(empty)';
  return k.slice(0, 8) + '...' + k.slice(-4);
}

function readSiloTokens() {
  try {
    const p = join(os.homedir(), '.refarm', 'identity.json');
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, 'utf8')).tokens ?? {};
  } catch { return {}; }
}

function fileAge(path) {
  const mtime = statSync(path).mtime;
  const mins = Math.floor((Date.now() - mtime.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fileSize(path) {
  const bytes = statSync(path).size;
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.round(bytes / 1024)}KB`;
}

// ── checks ────────────────────────────────────────────────────────────────────

function checkDaemon() {
  if (!existsSync(TRACTOR)) {
    fail('daemon', `tractor binary not found — build: cargo build --manifest-path packages/tractor/Cargo.toml --release`);
    return;
  }

  if (!existsSync(PID_FILE)) {
    info('daemon', `not running (no PID file) — start: ${scriptCommand('agent:daemon')}`);
    return;
  }

  const raw = readFileSync(PID_FILE, 'utf8').trim();
  const pid = parseInt(raw, 10);
  if (isNaN(pid)) {
    warn('daemon', `corrupt PID file (${PID_FILE})`);
    return;
  }

  try {
    process.kill(pid, 0);
    // Also do a WS health probe
    const r = spawnSync(TRACTOR, ['health', '--ws-port', '42000', '--skip-boot-probe'], {
      encoding: 'utf8', timeout: 2000,
    });
    if (r.status === 0) {
      ok('daemon', `running  ${c.dim}(pid ${pid})${c.reset}`);
    } else {
      warn('daemon', `process alive (pid ${pid}) but WS not responding`);
    }
  } catch {
    warn('daemon', `PID ${pid} not alive — stale PID file. Run: ${scriptCommand('agent:stop')}`);
  }
}

function effectiveProvider(envVars, silo, config) {
  return envVars.MODEL_PROVIDER || process.env.MODEL_PROVIDER || process.env.MODEL_DEFAULT_PROVIDER || config.provider || config.default_provider || config.modelProvider || silo.modelProvider || DEFAULT_MODEL_PROVIDER;
}

function checkKeys(envVars, config) {
  const KEY_LABELS = {
    ANTHROPIC_API_KEY: 'Anthropic',
    OPENAI_API_KEY:    'OpenAI',
    GROQ_API_KEY:      'Groq',
    MISTRAL_API_KEY:   'Mistral',
    XAI_API_KEY:       'xAI',
    DEEPSEEK_API_KEY:  'DeepSeek',
    TOGETHER_API_KEY:  'Together',
    OPENROUTER_API_KEY:'OpenRouter',
    GEMINI_API_KEY:    'Gemini',
  };

  const configured = [];
  const missing = [];
  for (const [envVar, label] of Object.entries(KEY_LABELS)) {
    const val = envVars[envVar] || process.env[envVar] || '';
    if (val) configured.push(`${label} ${c.dim}${maskedKey(val)}${c.reset}`);
    else missing.push(label);
  }

  if (configured.length > 0) {
    ok('keys', configured.join('  '));
    if (missing.length > 0) {
      info('keys', `not configured: ${c.dim}${missing.join(', ')}${c.reset}`);
    }
    return;
  }

  const silo = readSiloTokens();
  const provider = effectiveProvider(envVars, silo, config);
  const status = modelCredentialStatus(provider, silo, { ...process.env, ...envVars });
  if (status.state === 'silo-api-key') {
    ok('keys', `${provider} ${c.dim}${maskedKey(silo.modelApiKey)}${c.reset} ${c.dim}(silo)${c.reset}`);
  } else if (status.state === 'silo-oauth') {
    ok('keys', `${status.oauthProvider} ${c.dim}OAuth token present${c.reset} ${c.dim}(silo)${c.reset}`);
  } else if (status.state === 'not-required') {
    ok('keys', `${provider} ${c.dim}does not require API key${c.reset}`);
  } else {
    fail('keys', `no credentials — run: ${c.cyan}refarm sow${c.reset}`);
  }
}

function checkWasm() {
  if (!existsSync(PI_AGENT)) {
    fail('wasm', `pi_agent.wasm not found — build: cargo component build --manifest-path packages/pi-agent/Cargo.toml --release`);
    return;
  }
  ok('wasm', `${fileSize(PI_AGENT)}  ${c.dim}built ${fileAge(PI_AGENT)}${c.reset}`);
}

function checkTractorBinary() {
  if (!existsSync(TRACTOR)) {
    fail('tractor', `binary not found — build: cargo build --manifest-path packages/tractor/Cargo.toml --release`);
  } else {
    ok('tractor', `${fileSize(TRACTOR)}  ${c.dim}built ${fileAge(TRACTOR)}${c.reset}`);
  }
}

function checkModelConfig(envVars, config) {
  const silo = readSiloTokens();
  const provider = effectiveProvider(envVars, silo, config);
  const model    = envVars.MODEL_ID       || process.env.MODEL_ID       || config.modelId || config.model || silo.modelId || silo.model || defaultModelForProvider(provider);
  const history  = envVars.MODEL_HISTORY_TURNS    || process.env.MODEL_HISTORY_TURNS    || config.MODEL_HISTORY_TURNS    || '0';
  const maxIter  = envVars.MODEL_TOOL_CALL_MAX_ITER || process.env.MODEL_TOOL_CALL_MAX_ITER || config.MODEL_TOOL_CALL_MAX_ITER || '5';
  const budget   = provider ? config.budgets?.[provider] || '' : '';

  const parts = [
    `provider=${c.cyan}${provider}${c.reset}`,
    `model=${c.dim}${model ?? '(provider default)'}${c.reset}`,
    `history=${c.dim}${history} turns${c.reset}`,
    `max_iter=${c.dim}${maxIter}${c.reset}`,
  ];
  if (budget) parts.push(`budget=${c.dim}$${budget}/30d${c.reset}`);
  info('model', parts.join('  '));
}

function checkFsRoot(envVars, config) {
  const fsRoot = envVars.MODEL_FS_ROOT || process.env.MODEL_FS_ROOT || config.MODEL_FS_ROOT;
  if (!fsRoot) {
    warn('fs_root', 'MODEL_FS_ROOT not set — agent has unrestricted file access');
    return;
  }

  const resolved = resolve(fsRoot);
  const rootResolved = resolve(ROOT);

  if (!existsSync(resolved)) {
    fail('fs_root', `MODEL_FS_ROOT=${fsRoot} does not exist`);
    return;
  }

  // Safety check: FS root should be a subdirectory of repo root or a reasonable location
  if (!resolved.startsWith('/') || resolved === '/') {
    fail('fs_root', `MODEL_FS_ROOT=${fsRoot} is unsafe (root or empty)`);
    return;
  }

  ok('fs_root', `${c.dim}${resolved}${c.reset}`);

  const allowlist = envVars.MODEL_SHELL_ALLOWLIST || process.env.MODEL_SHELL_ALLOWLIST || config.MODEL_SHELL_ALLOWLIST;
  if (allowlist) {
    info('shell', `allowlist: ${c.dim}${allowlist}${c.reset}`);
  } else {
    warn('shell', 'MODEL_SHELL_ALLOWLIST not set — agent shell is unrestricted');
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

console.log(`\n${c.bold}pi-agent status${c.reset}  ${c.dim}${new Date().toLocaleTimeString()}${c.reset}\n`);

const envVars = readEnv();
const config  = readConfig();

checkDaemon();
checkTractorBinary();
checkWasm();
checkKeys(envVars, config);
checkModelConfig(envVars, config);
checkFsRoot(envVars, config);

console.log('');
