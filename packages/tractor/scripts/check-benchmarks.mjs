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

    current.files.forEach(f => {
        f.groups.forEach(g => {
            g.benchmarks.forEach(b => {
                const base = baselineMap.get(b.name);
                if (!base) return;

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

    const report = `
## 📊 Performance Benchmark Report

${tableRows.join('\n')}

**Summary:**
- 🚨 Regressions: ${regressions.length}
- 🚀 Improvements: ${improvements.length}
- ✅ Stable: ${stable.length}

${regressions.length > 0 ? '> [!CAUTION]\n> Performance degraded beyond the profile threshold (hybrid strict/trusted-fast). Please investigate the cause.' : '> [!TIP]\n> Performance is within acceptable hybrid thresholds.'}
`;

    fs.writeFileSync(REPORT_PATH, report);
    console.log(report);

    if (regressions.length > 0) {
        process.exit(1);
    }
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
