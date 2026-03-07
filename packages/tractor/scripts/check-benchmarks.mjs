import fs from 'node:fs';
import path from 'node:path';

const MARGIN = 0.10; // 10% tolerance
const BASELINE_PATH = path.resolve('benchmarks/baseline.json');
const CURRENT_PATH = path.resolve('benchmarks/current.json');
const REPORT_PATH = path.resolve('benchmarks/report.md');

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
        '| Benchmark | Baseline (ops/s) | Current (ops/s) | Δ % | Status |',
        '| :--- | :---: | :---: | :---: | :---: |'
    ];

    current.files.forEach(f => {
        f.groups.forEach(g => {
            g.benchmarks.forEach(b => {
                const base = baselineMap.get(b.name);
                if (!base) return;

                const diff = (b.hz - base.hz) / base.hz;
                const diffPct = (diff * 100).toFixed(2);

                let status = '✅';
                if (diff < -MARGIN) {
                    status = '🚨 REGRESSION';
                    regressions.push({ name: b.name, diff: diffPct });
                } else if (diff > MARGIN) {
                    status = '🚀 IMPROVED';
                    improvements.push({ name: b.name, diff: diffPct });
                } else {
                    stable.push({ name: b.name, diff: diffPct });
                }

                tableRows.push(`| ${b.name} | ${base.hz.toFixed(2)} | ${b.hz.toFixed(2)} | ${diff > 0 ? '+' : ''}${diffPct}% | ${status} |`);
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

${regressions.length > 0 ? '> [!CAUTION]\n> Performance degraded beyond the 10% margin. Please investigate the cause.' : '> [!TIP]\n> Performance is within acceptable limits.'}
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
