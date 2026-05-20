import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const CURRENT_COVERAGE_PATH = path.join(PROJECT_ROOT, 'coverage', 'coverage-summary.json');
const BASELINE_COVERAGE_PATH = path.join(PROJECT_ROOT, 'benchmarks', 'coverage-baseline.json');

async function main() {
    let baseline = { lines: { pct: 0 } };

    const envThreshold = process.env.COVERAGE_THRESHOLD;

    if (envThreshold && !Number.isNaN(parseFloat(envThreshold))) {
        console.log(`[coverage] Using environment threshold: ${envThreshold}%`);
        baseline.lines.pct = parseFloat(envThreshold);
    } else {
        try {
            const baselineRaw = await fs.readFile(BASELINE_COVERAGE_PATH, 'utf-8');
            const baselineJson = JSON.parse(baselineRaw);
            baseline.lines.pct = baselineJson.total.lines.pct;
            console.log(`[coverage] Using repository baseline threshold: ${baseline.lines.pct}%`);
        } catch (e) {
            console.warn(`[coverage] No baseline found at ${BASELINE_COVERAGE_PATH}. Defaulting to 0%.`);
        }
    }

    let current;
    try {
        const currentRaw = await fs.readFile(CURRENT_COVERAGE_PATH, 'utf-8');
        const currentJson = JSON.parse(currentRaw);
        current = currentJson.total.lines.pct;
        console.log(`[coverage] Current Line Coverage: ${current}%`);
    } catch (e) {
        console.error(`[coverage] Error reading current coverage at ${CURRENT_COVERAGE_PATH}. Did you run vitest with json-summary?`);
        process.exit(1);
    }

    const diff = (current - baseline.lines.pct).toFixed(2);

    if (current < baseline.lines.pct) {
        console.error(`\n❌ [coverage] QUALITY GATE FAILED: Coverage dropped by ${Math.abs(diff)}%`);
        console.error(`   Required: ${baseline.lines.pct}%`);
        console.error(`   Current:  ${current}%\n`);
        console.error(`   Please write tests for your new code to meet the baseline.`);
        process.exit(1);
    } else if (current > baseline.lines.pct) {
        console.log(`\n✅ [coverage] QUALITY GATE PASSED: Coverage increased by ${diff}%!`);
        console.log(`   Previous: ${baseline.lines.pct}%`);
        console.log(`   Current:  ${current}%\n`);
        console.log(`   🎉 Great job! Please run 'pnpm run coverage:save' to lock in this new high score.`);

        if (process.env.GITHUB_ACTIONS) {
            const ghaPayload = {
                improved: true,
                previous: baseline.lines.pct,
                current,
                diff,
            };
            await fs.writeFile(path.join(PROJECT_ROOT, 'coverage', 'gha-payload.json'), JSON.stringify(ghaPayload, null, 2));
        }

        process.exit(0);
    } else {
        console.log(`\n✅ [coverage] QUALITY GATE PASSED: Coverage is stable at ${current}%.\n`);

        if (process.env.GITHUB_ACTIONS) {
            const ghaPayload = { improved: false, previous: baseline.lines.pct, current, diff: 0 };
            await fs.writeFile(path.join(PROJECT_ROOT, 'coverage', 'gha-payload.json'), JSON.stringify(ghaPayload, null, 2));
        }

        process.exit(0);
    }
}

main().catch(err => {
    console.error('[coverage] Fatal error:', err);
    process.exit(1);
});
