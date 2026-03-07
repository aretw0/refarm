
## 📊 Performance Benchmark Report

| Benchmark | Baseline (ops/s) | Current (ops/s) | Δ % | Status |
| :--- | :---: | :---: | :---: | :---: |
| Tractor.boot() — zero-latency adapters | 3167.08 | 3559.30 | +12.38% | 🚀 IMPROVED |
| Tractor.boot() — 10ms schema latency | 92.91 | 90.96 | -2.10% | ✅ |
| Tractor.boot() — with sync adapter | 4109.88 | 3419.94 | -16.79% | 🚨 REGRESSION |
| Load 1 plugin | 9475.50 | 8718.62 | -7.99% | ✅ |
| Load 10 plugins sequentially | 977.25 | 994.64 | +1.78% | ✅ |
| Load 50 plugins concurrently | 256.37 | 267.66 | +4.41% | ✅ |
| Load 100 plugins concurrently | 115.72 | 144.79 | +25.12% | 🚀 IMPROVED |
| storeNode() x1 | 4079.81 | 5278.35 | +29.38% | 🚀 IMPROVED |
| storeNode() x100 sequential | 2057.83 | 2875.77 | +39.75% | 🚀 IMPROVED |
| storeNode() x100 concurrent | 2037.05 | 2661.02 | +30.63% | 🚀 IMPROVED |
| normaliseToSovereignGraph() x1 | 887240.64 | 997511.97 | +12.43% | 🚀 IMPROVED |
| normaliseToSovereignGraph() x1000 | 1025.84 | 1004.53 | -2.08% | ✅ |
| Boot → Load 10 plugins → Store 50 nodes → Query → Shutdown | 793.51 | 835.77 | +5.32% | ✅ |

**Summary:**
- 🚨 Regressions: 1
- 🚀 Improvements: 6
- ✅ Stable: 6

> [!CAUTION]
> Performance degraded beyond the 10% margin. Please investigate the cause.
