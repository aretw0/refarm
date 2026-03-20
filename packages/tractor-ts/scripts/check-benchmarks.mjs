import fs from 'node:fs';
import path from 'node:path';

const BASELINE_PATH = path.resolve('benchmarks/baseline.json');
const CURRENT_PATH = path.resolve('benchmarks/current.json');
const REPORT_PATH = path.resolve('benchmarks/report.md');

function marginForBenchmark(name) {
    // Option 3 (hybrid): strict margin for deterministic core transforms,
    // wider margin for integration-heavy flows where security hooks add overhead.
    if (name === "normaliseToSovereignGraph() x1") {
        return 0.10;
    }

    if (name === "normaliseToSovereignGraph() x1000") {
        return 0.25;
    }

    if (name === "Tractor.boot() — 10ms schema latency") {
        return 0.10;
    }

    return 0.55;
}

function loadJson(p) {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function printMeta(label, meta) {
    if (!meta) {
        return `${label}: unknown`;
    }

    return `${label}: sha=${meta.gitSha ?? 'unknown'} | branch=${meta.gitBranch ?? 'unknown'} | node=${meta.node ?? 'unknown'} | platform=${meta.platform ?? 'unknown'} | arch=${meta.arch ?? 'unknown'}`;
}

async function run() {
    const baseline = loadJson(BASELINE_PATH);
    const current = loadJson(CURRENT_PATH);

    if (!baseline || !current) {
        console.error('❌ Missing baseline or current benchmark files.');
        process.exit(1);
    }

    let regressions = [];
    let improvements = [];
    let stable = [];

    const baselineMap = new Map();
    baseline.files.forEach(f => {
        f.groups.forEach(g => {
            g.benchmarks.forEach(b => {
                baselineMap.set(b.name, b);
            });
        });
    });

    let tableRows = [
        '| Benchmark | Baseline (ops/s) | Current (ops/s) | Δ % | Threshold | Status |',
        '| :--- | :---: | :---: | :---: | :---: | :---: |'
    ];

    const baselineMeta = baseline._meta;
    const currentMeta = current._meta;
    const environmentComparable = baselineMeta && currentMeta
        ? baselineMeta.node === currentMeta.node && baselineMeta.platform === currentMeta.platform && baselineMeta.arch === currentMeta.arch
        : false;

    current.files.forEach(f => {
        f.groups.forEach(g => {
            g.benchmarks.forEach(b => {
                const base = baselineMap.get(b.name);
                if (!base || typeof base.hz !== 'number' || typeof b.hz !== 'number') return;

                const diff = (b.hz - base.hz) / base.hz;
                const diffPct = (diff * 100).toFixed(2);
                const margin = marginForBenchmark(b.name);

                let status = '✅';
                if (diff < -margin) {
                    status = '🚨 REGRESSION';
                    regressions.push({ name: b.name, diff: diffPct });
                } else if (diff > margin) {
                    status = '🚀 IMPROVED';
                    improvements.push({ name: b.name, diff: diffPct });
                } else {
                    stable.push({ name: b.name, diff: diffPct });
                }

                tableRows.push(`| ${b.name} | ${base.hz.toFixed(2)} | ${b.hz.toFixed(2)} | ${diff > 0 ? '+' : ''}${diffPct}% | ${(margin * 100).toFixed(0)}% | ${status} |`);
            });
        });
    });

    // Calculate Average Improvement
    let totalDiff = 0;
    let baselineCount = 0;

    current.files.forEach(f => {
        f.groups.forEach(g => {
            g.benchmarks.forEach(b => {
                const base = baselineMap.get(b.name);
                if (base && typeof base.hz === 'number' && typeof b.hz === 'number') {
                    totalDiff += ((b.hz - base.hz) / base.hz) * 100;
                    baselineCount++;
                }
            });
        });
    });

    const averageDiff = baselineCount > 0 ? (totalDiff / baselineCount) : 0;

    // Priority Threshold for PR Comments
    // 1. CI Env -> 2. Local Env -> 3. Default (5%)
    const envMargin = process.env.BENCHMARK_MARGIN_PCT;
    const commentThreshold = (envMargin && !Number.isNaN(parseFloat(envMargin)))
        ? parseFloat(envMargin)
        : 5.0; // Default 5% average improvement required to trigger a PR comment

    const report = `
## 📊 Performance Benchmark Report

${printMeta('Baseline meta', baselineMeta)}
${printMeta('Current meta', currentMeta)}

${environmentComparable ? 'Environment comparability: ✅ node/platform/arch match' : 'Environment comparability: ⚠️ node/platform/arch differ or missing metadata'}

${tableRows.join('\n')}

**Summary:**
- 🚨 Regressions: ${regressions.length}
- 🚀 Improvements: ${improvements.length}
- ✅ Stable: ${stable.length}
- 📈 Average Diff: ${averageDiff >= 0 ? '+' : ''}${averageDiff.toFixed(2)}%

${regressions.length > 0 ? '> [!CAUTION]\n> Performance degraded beyond the profile threshold (hybrid strict/trusted-fast). Please investigate the cause.' : '> [!TIP]\n> Performance is within acceptable hybrid thresholds.'}
`;

    fs.writeFileSync(REPORT_PATH, report);
    console.log(report);

    // Output payload for GitHub Actions to pick up and comment on the PR
    if (process.env.GITHUB_ACTIONS && regressions.length === 0) {
        const ghaPayload = {
            improved: averageDiff > commentThreshold,
            diff: averageDiff.toFixed(2),
            threshold: commentThreshold
        };

        fs.writeFileSync(path.resolve('benchmarks/gha-payload.json'), JSON.stringify(ghaPayload, null, 2));
    }

    if (regressions.length > 0) {
        process.exit(1);
    }
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
