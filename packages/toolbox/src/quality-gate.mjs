#!/usr/bin/env node

/**
 * quality-gate.mjs
 * 
 * Enforces the SDD->BDD->TDD->DDD workflow by ensuring that changes to source code
 * are accompanied by corresponding updates to specifications and tests.
 * 
 * Usage:
 *   node quality-gate.mjs [--strict] [--branch <name>]
 */

import { execSync } from 'child_process';

const args = process.argv.slice(2);
const isStrict = args.includes('--strict');
const targetBranch = args.includes('--branch') ? args[args.indexOf('--branch') + 1] : 'main';

console.log(`🔍 Running Refarm Quality Gate (SDD->BDD->TDD->DDD)...`);

try {
    // 1. Get changed files compared to target branch
    const changedFiles = execSync(`git diff --name-only origin/${targetBranch}...HEAD`)
        .toString()
        .split('\n')
        .filter(Boolean);

    if (changedFiles.length === 0) {
        console.log('✅ No changes detected.');
        process.exit(0);
    }

    const srcChanges = changedFiles.filter(f => f.includes('/src/') && /\.(ts|js|mjs|wit)$/.test(f));
    const specChanges = changedFiles.filter(f => f.startsWith('specs/') || f.includes('/specs/'));
    const testChanges = changedFiles.filter(f => f.includes('/test/') || f.endsWith('.test.ts') || f.endsWith('.spec.ts'));

    let violations = [];

    // Rule A: SDD (Spec-Driven Development)
    // If source code changed, there should be a corresponding spec update or ADR.
    if (srcChanges.length > 0 && specChanges.length === 0) {
        violations.push(`[SDD] Source code changed but NO specification updates found in 'specs/'.`);
    }

    // Rule B: BDD/TDD (Test-Driven Development)
    // If source code changed, there should be corresponding test updates.
    if (srcChanges.length > 0 && testChanges.length === 0) {
        violations.push(`[TDD] Source code changed but NO test updates found.`);
    }

    if (violations.length > 0) {
        console.warn(`\n⚠️ Quality Gate Violations:`);
        violations.forEach(v => console.warn(`  - ${v}`));

        if (isStrict) {
            console.error(`\n❌ Strict mode: Blocking execution. Please document specs/tests before pushing.`);
            process.exit(1);
        } else {
            console.warn(`\nℹ️ Permissive mode: These are warnings. Please consider aligning with the workflow.`);
        }
    } else {
        console.log(`✅ Workflow alignment verified (Source + Spec + Test found).`);
    }

} catch (err) {
    console.error(`❌ Failed to run quality gate: ${err.message}`);
    // Don't block if git fails (e.g. no origin)
    process.exit(0);
}
