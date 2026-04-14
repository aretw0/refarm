#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

let failures = 0;
let warnings = 0;

function commandExists(command) {
  const result = spawnSync('bash', ['-lc', `command -v ${command}`], {
    encoding: 'utf8'
  });
  return result.status === 0;
}

function run(command, args = [], options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
}

function ok(label, detail = '') {
  console.log(`${colors.green}✅${colors.reset} ${label}`);
  if (detail) {
    console.log(`${colors.dim}   ${detail}${colors.reset}`);
  }
}

function warn(label, detail = '') {
  warnings += 1;
  console.log(`${colors.yellow}⚠️${colors.reset} ${label}`);
  if (detail) {
    console.log(`${colors.dim}   ${detail}${colors.reset}`);
  }
}

function fail(label, detail = '') {
  failures += 1;
  console.log(`${colors.red}❌${colors.reset} ${label}`);
  if (detail) {
    console.log(`${colors.dim}   ${detail}${colors.reset}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseGitHubRepo(url) {
  // git@github.com:owner/repo.git
  let match = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (match) return `${match[1]}/${match[2]}`;

  // https://github.com/owner/repo.git
  match = url.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (match) return `${match[1]}/${match[2]}`;

  return null;
}

function checkNode() {
  const result = run('node', ['--version']);
  if (result.status !== 0) {
    fail('Node.js is not available', result.stderr.trim());
    return;
  }

  const version = result.stdout.trim();
  const major = Number(version.replace(/^v/, '').split('.')[0] || '0');

  if (major >= 22) {
    ok('Node.js runtime', version);
  } else {
    fail('Node.js runtime is below the project baseline (>=22)', version);
  }
}

function checkNpm() {
  const result = run('npm', ['--version']);
  if (result.status !== 0) {
    fail('npm is not available', result.stderr.trim());
    return;
  }

  ok('npm runtime', result.stdout.trim());
}

function checkLockfile() {
  if (existsSync('package-lock.json')) {
    ok('package-lock.json present');
  } else {
    fail('package-lock.json missing');
  }
}

function checkHooks() {
  if (existsSync('.git/hooks/pre-push')) {
    ok('Git pre-push hook installed');
  } else {
    warn('Git pre-push hook missing', 'Run: npm run hooks:install');
  }
}

function checkRustToolchain() {
  if (!commandExists('rustup')) {
    fail('rustup is not available');
    return;
  }

  const active = run('rustup', ['show', 'active-toolchain']);
  if (active.status !== 0) {
    fail('Rust active toolchain is not healthy', active.stderr.trim() || active.stdout.trim());
    return;
  }

  const activeLine = active.stdout.trim();
  if (!activeLine.startsWith('stable')) {
    warn('Rust active toolchain is not stable', activeLine);
  } else {
    ok('Rust active toolchain', activeLine);
  }

  const stableAlias = run('bash', ['-lc', 'RUSTUP_TOOLCHAIN=stable rustc -vV']);
  if (stableAlias.status !== 0) {
    fail('RUSTUP_TOOLCHAIN=stable is not healthy', (stableAlias.stderr || stableAlias.stdout).trim());
    return;
  }
  ok('RUSTUP_TOOLCHAIN=stable alias is healthy');

  const list = run('rustup', ['target', 'list', '--installed']);
  if (list.status !== 0) {
    fail('Unable to query installed Rust targets', list.stderr.trim());
    return;
  }

  const installed = new Set(list.stdout.split('\n').map((line) => line.trim()).filter(Boolean));
  const requiredTargets = [
    'x86_64-unknown-linux-gnu',
    'wasm32-unknown-unknown',
    'wasm32-wasip1'
  ];

  const missing = requiredTargets.filter((target) => !installed.has(target));
  if (missing.length === 0) {
    ok('Rust targets installed', requiredTargets.join(', '));
  } else {
    fail('Missing Rust targets', missing.join(', '));
  }
}

function checkWasmTooling() {
  if (commandExists('cargo-component')) {
    const version = run('cargo-component', ['--version']);
    ok('cargo-component installed', version.stdout.trim());
  } else {
    fail('cargo-component is missing', 'Install in devcontainer bootstrap or run cargo install --locked cargo-component@0.21.1');
  }

  if (commandExists('wasm-tools')) {
    const version = run('wasm-tools', ['--version']);
    ok('wasm-tools installed', version.stdout.trim());
  } else {
    fail('wasm-tools is missing', 'Install via devcontainer bootstrap');
  }
}

function checkReso() {
  const result = run('node', ['scripts/reso.mjs', 'status']);
  if (result.status === 0) {
    ok('Resolution matrix check (reso status)');
  } else {
    warn('Resolution matrix check failed', (result.stderr || result.stdout).trim().split('\n').slice(-3).join('\n'));
  }
}

function checkGitHubAutomationPermissions() {
  if (!commandExists('gh')) {
    warn('GitHub CLI not installed', 'Skipping automation permission checks');
    return;
  }

  const auth = run('gh', ['auth', 'status']);
  if (auth.status !== 0) {
    warn('GitHub CLI not authenticated', 'Skipping automation permission checks');
    return;
  }

  const origin = run('git', ['config', '--get', 'remote.origin.url']);
  if (origin.status !== 0) {
    warn('No git remote.origin configured', 'Skipping automation permission checks');
    return;
  }

  const repo = parseGitHubRepo(origin.stdout.trim());
  if (!repo) {
    warn('Could not parse GitHub repository from remote URL', origin.stdout.trim());
    return;
  }

  const permissions = run('gh', ['api', `repos/${repo}/actions/permissions/workflow`]);
  if (permissions.status !== 0) {
    warn('Could not query Actions workflow permissions', permissions.stderr.trim());
    return;
  }

  try {
    const data = JSON.parse(permissions.stdout);
    const defaultPerm = data.default_workflow_permissions;
    const canApprovePr = data.can_approve_pull_request_reviews;

    if (defaultPerm === 'write') {
      ok('GitHub Actions workflow default permission is write');
    } else {
      warn('GitHub Actions workflow default permission is not write', `Current: ${defaultPerm || 'unknown'} (dependency bot PR creation may fail)`);
    }

    if (canApprovePr === true) {
      ok('GitHub Actions can approve pull requests');
    } else {
      warn('GitHub Actions cannot approve pull requests', 'Enable "Allow GitHub Actions to create and approve pull requests" in repository settings');
    }
  } catch (error) {
    warn('Failed to parse Actions workflow permissions response', String(error));
  }
}

function checkPackageManagerPin() {
  if (!existsSync('package.json')) {
    fail('package.json missing');
    return;
  }

  const pkg = readJson('package.json');
  if (typeof pkg.packageManager === 'string' && pkg.packageManager.startsWith('npm@')) {
    ok('packageManager pin present', pkg.packageManager);
  } else {
    warn('packageManager pin missing in package.json', 'Pinning npm improves reproducibility across devcontainers/swarms');
  }
}

console.log(`${colors.cyan}🧪 Refarm Factory Preflight${colors.reset}`);
console.log(`${colors.dim}Checks for deterministic swarm execution in devcontainers and CI.${colors.reset}\n`);

checkNode();
checkNpm();
checkLockfile();
checkPackageManagerPin();
checkHooks();
checkRustToolchain();
checkWasmTooling();
checkReso();
checkGitHubAutomationPermissions();

console.log('\n' + `${colors.cyan}Summary${colors.reset}`);
console.log(`- failures: ${failures}`);
console.log(`- warnings: ${warnings}`);

if (failures > 0) {
  console.log(`${colors.red}\nFactory is NOT ready for swarm execution.${colors.reset}`);
  process.exit(1);
}

if (warnings > 0) {
  console.log(`${colors.yellow}\nFactory is usable with warnings.${colors.reset}`);
} else {
  console.log(`${colors.green}\nFactory is ready for swarm execution.${colors.reset}`);
}
