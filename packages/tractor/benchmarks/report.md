
## 📊 Performance Benchmark Report

Baseline meta: sha=d71f2ff | branch=main | node=v22.16.0 | platform=linux | arch=x64
Current meta: sha=d71f2ff | branch=main | node=v22.16.0 | platform=linux | arch=x64

Environment comparability: ✅ node/platform/arch match

| Benchmark | Baseline (ops/s) | Current (ops/s) | Δ % | Threshold | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Tractor.boot() — zero-latency adapters | 2274.26 | 2289.85 | +0.69% | 55% | ✅ |
| Tractor.boot() — 10ms schema latency | 90.48 | 90.41 | -0.08% | 10% | ✅ |
| Tractor.boot() — with sync adapter | 3291.93 | 2770.22 | -15.85% | 55% | ✅ |
| Load 1 plugin | 2798.85 | 2161.42 | -22.77% | 55% | ✅ |
| Load 10 plugins sequentially | 267.99 | 267.82 | -0.06% | 55% | ✅ |
| Load 50 plugins concurrently | 68.28 | 62.00 | -9.20% | 55% | ✅ |
| Load 100 plugins concurrently | 34.31 | 33.69 | -1.83% | 55% | ✅ |
| storeNode() x1 | 3216.46 | 3177.84 | -1.20% | 55% | ✅ |
| storeNode() x100 sequential | 1405.38 | 1265.08 | -9.98% | 55% | ✅ |
| storeNode() x100 concurrent | 1354.41 | 1366.91 | +0.92% | 55% | ✅ |
| normaliseToSovereignGraph() x1 | 978351.40 | 1028695.23 | +5.15% | 10% | ✅ |
| normaliseToSovereignGraph() x1000 | 966.96 | 1001.89 | +3.61% | 25% | ✅ |
| Boot → Load 10 plugins → Store 50 nodes → Query → Shutdown | 233.94 | 235.53 | +0.68% | 55% | ✅ |

**Summary:**
- 🚨 Regressions: 0
- 🚀 Improvements: 0
- ✅ Stable: 13

> [!TIP]
> Performance is within acceptable hybrid thresholds.
