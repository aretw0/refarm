#!/usr/bin/env node
/**
 * agent-repl — interactive multi-turn session with pi-agent
 *
 * Usage:
 *   npm run agent:repl
 *   npm run agent:repl -- --ws-port 42001 --namespace dev
 *
 * Prerequisites:
 *   npm run agent:daemon   (or agent:start in a separate terminal)
 *   npm run agent:keys     (configure at least one LLM provider)
 */

import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const TRACTOR = join(ROOT, 'packages/tractor/target/release/tractor');
const HISTORY_FILE = join(ROOT, '.refarm', '.repl_history');
const ENV_FILE = join(ROOT, '.refarm', '.env');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', blue: '\x1b[34m',
};

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
}
const WS_PORT  = getArg('--ws-port', '42000');
const NS       = getArg('--namespace', 'default');
const AGENT    = getArg('--agent', 'pi_agent');
const TIMEOUT  = getArg('--timeout-ms', '60000');

// ── helpers ───────────────────────────────────────────────────────────────────

function loadEnvFile() {
  if (!existsSync(ENV_FILE)) return;
  const lines = readFileSync(ENV_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

function checkDaemon() {
  if (!existsSync(TRACTOR)) {
    console.error(`${c.red}tractor binary not found at ${TRACTOR}${c.reset}`);
    console.error(`Build first: cd packages/tractor && cargo build --release`);
    process.exit(1);
  }
  const r = spawnSync(TRACTOR, ['health', '--ws-port', WS_PORT, '--skip-boot-probe'], {
    encoding: 'utf8', timeout: 3000,
  });
  return r.status === 0;
}

function readHistory() {
  if (!existsSync(HISTORY_FILE)) return [];
  return readFileSync(HISTORY_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-500);
}

function appendHistory(line) {
  try {
    mkdirSync(join(ROOT, '.refarm'), { recursive: true });
    appendFileSync(HISTORY_FILE, line + '\n');
  } catch { /* best-effort */ }
}

function sendPrompt(payload) {
  const r = spawnSync(
    TRACTOR,
    [
      'prompt',
      '--agent', AGENT,
      '--payload', payload,
      '--ws-port', WS_PORT,
      '--namespace', NS,
      '--wait-timeout-ms', TIMEOUT,
      '--format', 'plain',
    ],
    {
      encoding: 'utf8',
      timeout: parseInt(TIMEOUT, 10) + 5000,
      env: process.env,
    }
  );

  if (r.error) return { ok: false, output: `[connection error: ${r.error.message}]` };
  if (r.status !== 0) {
    const err = (r.stderr || '').trim() || `exit ${r.status}`;
    return { ok: false, output: `[error: ${err}]` };
  }

  // stderr has status messages (e.g. "sending to pi_agent…" and token metadata)
  const meta = (r.stderr || '').trim();
  return { ok: true, output: (r.stdout || '').trimEnd(), meta };
}

// ── banner ────────────────────────────────────────────────────────────────────

function printBanner(provider) {
  const prov = provider ? ` ${c.cyan}${provider}${c.reset}` : '';
  console.log(`\n${c.bold}pi-agent REPL${c.reset}${prov}  ${c.dim}(Ctrl+C or /quit to exit • /help for commands)${c.reset}`);
  console.log(`${c.dim}namespace=${NS}  port=${WS_PORT}  agent=${AGENT}${c.reset}\n`);
}

// ── special commands ──────────────────────────────────────────────────────────

// ── /tree rendering ───────────────────────────────────────────────────────────

function queryNodes(type, limit = 100) {
  const r = spawnSync(
    TRACTOR,
    ['query', '--type', type, '--limit', String(limit), '--ws-port', WS_PORT, '--namespace', NS, '--format', 'json'],
    { encoding: 'utf8', timeout: 5000, env: process.env }
  );
  if (r.status !== 0) return [];
  try { return JSON.parse(r.stdout || '[]'); } catch { return []; }
}

function printTree() {
  const sessions = queryNodes('Session', 10);
  if (sessions.length === 0) {
    console.log(`\n${c.dim}No sessions found. Start a conversation first.${c.reset}\n`);
    return;
  }

  // Most recent session first
  sessions.sort((a, b) => (b.created_at_ns || 0) - (a.created_at_ns || 0));
  const session = sessions[0];
  const sessionName = session.name || session['@id'] || '(unnamed)';
  const leaf = session.leaf_entry_id;

  console.log(`\n${c.bold}Session tree${c.reset}  ${c.dim}${sessionName}${c.reset}`);
  if (!leaf) {
    console.log(`  ${c.dim}(empty session)${c.reset}\n`);
    return;
  }

  const entries = queryNodes('SessionEntry', 200);
  if (entries.length === 0) {
    console.log(`  ${c.dim}(no entries yet)${c.reset}\n`);
    return;
  }

  // Build index + child map
  const byId = {};
  for (const e of entries) if (e['@id']) byId[e['@id']] = e;

  const children = {};
  for (const e of entries) {
    const pid = e.parent_entry_id;
    if (!children[pid]) children[pid] = [];
    children[pid].push(e['@id']);
  }

  // Find roots (no parent_entry_id or parent not in set)
  const roots = entries.filter(e => !e.parent_entry_id || !byId[e.parent_entry_id]).map(e => e['@id']);

  const kindIcon = { user: '>', agent: '<', tool_call: '[', tool_result: ']' };

  function printNode(id, prefix, isLast) {
    const e = byId[id];
    if (!e) return;
    const icon = kindIcon[e.kind] || '?';
    const isCurrent = id === leaf;
    const snippet = (e.content || '').replace(/\n/g, ' ').slice(0, 55);
    const marker = isCurrent ? `${c.green}*${c.reset} ` : '  ';
    const branchChar = isLast ? '└─' : '├─';
    console.log(`${prefix}${branchChar} ${marker}${c.dim}${icon}${c.reset} ${isCurrent ? c.bold : c.dim}${snippet}${c.reset}`);

    const kids = children[id] || [];
    const childPrefix = prefix + (isLast ? '   ' : '│  ');
    kids.forEach((kid, i) => printNode(kid, childPrefix, i === kids.length - 1));
  }

  roots.forEach((rid, i) => printNode(rid, '  ', i === roots.length - 1));
  console.log('');
}

// ── /sessions listing ─────────────────────────────────────────────────────────

function formatTs(ns) {
  if (!ns) return '(unknown)';
  const ms = Math.floor(Number(ns) / 1_000_000);
  return new Date(ms).toLocaleString();
}

function printSessions() {
  const sessions = queryNodes('Session', 50);
  if (sessions.length === 0) {
    console.log(`\n${c.dim}No sessions found. Start a conversation first.${c.reset}\n`);
    return;
  }

  sessions.sort((a, b) => (b.created_at_ns || 0) - (a.created_at_ns || 0));
  const activeId = sessions[0]['@id'];

  console.log(`\n${c.bold}Sessions${c.reset}  ${c.dim}(${sessions.length} total, most recent first)${c.reset}`);
  for (const s of sessions) {
    const id   = s['@id'] || '?';
    const name = s.name || c.dim + '(unnamed)' + c.reset;
    const ts   = formatTs(s.created_at_ns);
    const leaf = s.leaf_entry_id ? c.dim + s.leaf_entry_id.slice(0, 8) + '…' + c.reset : c.dim + '(empty)' + c.reset;
    const marker = id === activeId ? `${c.green}*${c.reset}` : ' ';
    console.log(`  ${marker} ${c.cyan}${id.slice(0, 8)}…${c.reset}  ${name}  ${c.dim}${ts}${c.reset}  leaf=${leaf}`);
  }
  console.log('');
}

// ── slash commands ────────────────────────────────────────────────────────────

function handleSlashCommand(line) {
  const cmd = line.trim().toLowerCase();
  if (cmd === '/quit' || cmd === '/exit') {
    console.log(`\n${c.dim}Goodbye.${c.reset}\n`);
    process.exit(0);
  }
  if (cmd === '/help') {
    console.log(`\n${c.bold}Commands:${c.reset}`);
    console.log(`  ${c.cyan}/help${c.reset}      — show this message`);
    console.log(`  ${c.cyan}/quit${c.reset}      — exit the REPL`);
    console.log(`  ${c.cyan}/clear${c.reset}     — clear the screen`);
    console.log(`  ${c.cyan}/tree${c.reset}      — show session branch tree (most recent session)`);
    console.log(`  ${c.cyan}/sessions${c.reset}  — list all sessions with id, name, and date`);
    console.log(`\n${c.dim}Everything else is sent as a prompt to pi-agent.${c.reset}\n`);
    return true;
  }
  if (cmd === '/clear') {
    process.stdout.write('\x1b[2J\x1b[H');
    return true;
  }
  if (cmd === '/tree') {
    printTree();
    return true;
  }
  if (cmd === '/sessions') {
    printSessions();
    return true;
  }
  return false;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  loadEnvFile();

  const provider = process.env.LLM_PROVIDER || 'ollama';

  // Check daemon is alive
  const daemonRunning = checkDaemon();
  if (!daemonRunning) {
    console.error(`${c.yellow}Daemon not responding on port ${WS_PORT}.${c.reset}`);
    console.error(`Start it first:  ${c.cyan}npm run agent:daemon${c.reset}`);
    console.error(`Or:              ${c.cyan}npm run agent:start${c.reset}  (foreground)`);
    process.exit(1);
  }

  printBanner(provider);

  // Readline with history
  const history = readHistory();
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.bold}${c.green}>${c.reset} `,
    history,
    historySize: 500,
    terminal: true,
  });

  rl.prompt();

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    // Slash commands
    if (trimmed.startsWith('/')) {
      if (!handleSlashCommand(trimmed)) {
        console.log(`${c.yellow}Unknown command: ${trimmed}${c.reset}`);
      }
      rl.prompt();
      return;
    }

    appendHistory(trimmed);

    // Send to agent
    const { ok, output, meta } = sendPrompt(trimmed);

    if (!ok) {
      console.log(`\n${c.red}${output}${c.reset}\n`);
    } else {
      console.log(`\n${output}`);
      if (meta) {
        // Strip the "sending to..." line, keep only the token metadata line
        const metaLines = meta.split('\n').filter(l => l.startsWith('#'));
        if (metaLines.length > 0) {
          console.log(`${c.dim}${metaLines.join(' ')}${c.reset}`);
        }
      }
      console.log('');
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`\n${c.dim}Session ended.${c.reset}\n`);
    process.exit(0);
  });

  // Ctrl+C on empty line exits gracefully
  rl.on('SIGINT', () => {
    console.log(`\n${c.dim}Goodbye.${c.reset}\n`);
    process.exit(0);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
