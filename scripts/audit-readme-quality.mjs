import fs from 'fs';
import path from 'path';

/**
 * Audit README Quality for the "First 5 Minutes" Dev Experience.
 * This replaces manual verification of documentation quality.
 */

const TEMPLATE_REDMES = [
    'examples/hello-world-plugin/README.md',
    'packages/terminal-plugin/README.md',
];

const MANDATORY_HEADERS = [
    'Quick Start',
    'Installation',
    'Usage',
];

async function audit() {
    console.log('🔍 Auditing Documentation Quality...');
    let hasErrors = false;

    for (const relPath of TEMPLATE_REDMES) {
        const absPath = path.resolve(process.cwd(), relPath);
        if (!fs.existsSync(absPath)) {
            console.warn(`⚠️  README not found: ${relPath}`);
            continue;
        }

        const content = fs.readFileSync(absPath, 'utf-8');
        const missing = MANDATORY_HEADERS.filter(h => !content.includes(`# ${h}`) && !content.includes(`## ${h}`));

        if (missing.length > 0) {
            console.error(`❌ ${relPath}: Missing mandatory headers: ${missing.join(', ')}`);
            hasErrors = true;
        } else {
            console.log(`✅ ${relPath}: Passed quality check.`);
        }
    }

    if (hasErrors) {
        process.exit(1);
    }
}

audit();
