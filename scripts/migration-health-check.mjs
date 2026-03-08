import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    bold: '\x1b[1m',
};

const log = (msg) => console.log(`${colors.blue}[migration-check]${colors.reset} ${msg}`);
const success = (msg) => console.log(`${colors.green}✔ ${msg}${colors.reset}`);
const error = (msg) => console.log(`${colors.red}✘ ${msg}${colors.reset}`);

function run(cmd, desc) {
    log(`Running: ${desc}...`);
    try {
        execSync(cmd, { stdio: 'inherit' });
        success(desc);
        return true;
    } catch (e) {
        error(`Failed: ${desc}`);
        return false;
    }
}

async function main() {
    console.log(`\n${colors.bold}--- Refarm Pre-Migration Health Check ---${colors.reset}\n`);

    let allPassed = true;

    // 1. Lint & Type Check
    allPassed &= run('npm run lint', 'Linting (Turbo)');
    allPassed &= run('npm run type-check', 'Type Checking (Turbo)');

    // 2. Capability Contracts (BDD)
    allPassed &= run('npm run test:capabilities', 'Capability Contracts (storage, identity, sync, manifest)');

    // 3. Benchmarks (Baselines)
    if (existsSync('packages/tractor/benchmarks/baseline.json')) {
        success('Benchmark baseline exists');
    } else {
        log(`${colors.yellow}⚠ Benchmark baseline missing (Recommended but not fatal)${colors.reset}`);
    }

    // 4. URL Consistency (Housechores)
    const rootPkg = JSON.parse(readFileSync('package.json', 'utf-8'));
    const expectedRepo = 'https://github.com/refarm-dev/refarm.git';
    const expectedPrefix = 'git+';

    if (rootPkg.repository?.url === `${expectedPrefix}${expectedRepo}` || rootPkg.repository?.url === expectedRepo) {
        success('Root repository URL is correct (refarm-dev)');
    } else {
        error(`Root repository URL mismatch: ${rootPkg.repository?.url}`);
        allPassed = false;
    }

    // 5. Plugin Smoke Test (Storage Memory)
    log('Running Storage Memory Smoke Test...');
    if (existsSync('packages/storage-memory/package.json')) {
        success('Storage Memory package found');
    } else {
        error('Storage Memory package missing (was hello-world-plugin)');
        allPassed = false;
    }

    console.log(`\n${colors.bold}--- Result ---${colors.reset}`);
    if (allPassed) {
        console.log(`${colors.green}${colors.bold}READY FOR MIGRATION IN GRAND STYLE! 🚀${colors.reset}\n`);
        process.exit(0);
    } else {
        console.log(`${colors.red}${colors.bold}MIGRATION BLOCKED. Review failures above.${colors.reset}\n`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
