import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const target = process.argv[2];
if (!target || !fs.existsSync(target)) {
    console.error('Usage: node sanitize-bench.mjs <file>');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(target, 'utf8'));
const root = process.cwd();

function safeExec(cmd, fallback = 'unknown') {
    try {
        return execSync(cmd, { stdio: 'pipe' }).toString().trim() || fallback;
    } catch {
        return fallback;
    }
}

data.files.forEach(f => {
    // Make path relative to the package root
    if (path.isAbsolute(f.filepath)) {
        f.filepath = path.relative(root, f.filepath);
    }
});

data._meta = {
    generatedAt: new Date().toISOString(),
    gitSha: safeExec('git rev-parse --short HEAD'),
    gitBranch: safeExec('git rev-parse --abbrev-ref HEAD'),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: safeExec("node -p \"require('os').cpus()?.[0]?.model || 'unknown'\"")
};

fs.writeFileSync(target, JSON.stringify(data, null, 2));
console.log(`✅ Sanitized paths in ${target}`);
