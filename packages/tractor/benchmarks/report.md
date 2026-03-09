
## 📊 Performance Benchmark Report

| Benchmark | Baseline (ops/s) | Current (ops/s) | Δ % | Threshold | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Tractor.boot() — zero-latency adapters | 3320.45 | 2337.46 | -29.60% | 55% | ✅ |
| Tractor.boot() — 10ms schema latency | 91.65 | 93.53 | +2.04% | 10% | ✅ |
| Tractor.boot() — with sync adapter | 4024.58 | 2370.85 | -41.09% | 55% | ✅ |
| Load 1 plugin | 9081.69 | 4824.81 | -46.87% | 55% | ✅ |
| Load 10 plugins sequentially | 1067.33 | 508.83 | -52.33% | 55% | ✅ |
| Load 50 plugins concurrently | 280.61 | 139.01 | -50.46% | 55% | ✅ |
| Load 100 plugins concurrently | 121.44 | 68.64 | -43.48% | 55% | ✅ |
| storeNode() x1 | 4158.65 | 2505.16 | -39.76% | 55% | ✅ |
| storeNode() x100 sequential | 2359.75 | 1253.64 | -46.87% | 55% | ✅ |
| storeNode() x100 concurrent | 2503.35 | 1238.07 | -50.54% | 55% | ✅ |
| normaliseToSovereignGraph() x1 | 870865.01 | 936995.39 | +7.59% | 10% | ✅ |
| normaliseToSovereignGraph() x1000 | 1021.41 | 1039.89 | +1.81% | 25% | ✅ |
| Boot → Load 10 plugins → Store 50 nodes → Query → Shutdown | 723.37 | 392.64 | -45.72% | 55% | ✅ |

**Summary:**
- 🚨 Regressions: 0
- 🚀 Improvements: 0
- ✅ Stable: 13

> [!TIP]
> Performance is within acceptable hybrid thresholds.
