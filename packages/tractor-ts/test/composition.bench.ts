/**
 * Refarm Composition Benchmarks (Stress & Precision)
 * 
 * Massive iteration multiplier to force measurable durations for
 * extremely efficient Map/List lookups.
 * 
 * Run: npx vitest bench test/composition.bench.ts
 */

import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { beforeAll, bench, describe } from "vitest";
import { Tractor } from "../src/index";
import { createMockConfig } from "./helpers/mock-adapters";

// Silence Tractor logs during benchmarks
console.info = () => {};

describe("Compositional Performance (Stress Load)", () => {
    let tractor10: Tractor;
    let tractor1000Last: Tractor;
    let tractor1000Random: Tractor;
    
    // 100,000 iterations to ensure a measurable impact of the O(N) lookup
    const ITERATIONS = 100000;

    beforeAll(async () => {
        // Setup Tractor with 10 plugins
        tractor10 = await Tractor.boot(createMockConfig());
        await tractor10.plugins.load(createMockManifest({ 
            id: "@refarm.dev/provider", 
            capabilities: { provides: ["test"], requires: [], providesApi: ["MyApi"] } 
        }));
        for (let i = 0; i < 9; i++) {
            await tractor10.plugins.load(createMockManifest({ id: `@refarm.dev/p${i}` }));
        }

        // Setup Tractor with 1000 plugins (Provider last)
        tractor1000Last = await Tractor.boot(createMockConfig());
        for (let i = 0; i < 999; i++) {
            await tractor1000Last.plugins.load(createMockManifest({ id: `@refarm.dev/p${i}` }));
        }
        await tractor1000Last.plugins.load(createMockManifest({ 
            id: "@refarm.dev/provider", 
            capabilities: { provides: ["test"], requires: [], providesApi: ["MyApi"] } 
        }));

        // Setup Tractor with 1000 plugins (Random providers)
        tractor1000Random = await Tractor.boot(createMockConfig());
        for (let i = 0; i < 1000; i++) {
            const isProvider = i === 500;
            await tractor1000Random.plugins.load(createMockManifest({ 
                id: `@refarm.dev/p${i}`,
                capabilities: { 
                    provides: ["test"], 
                    requires: [], 
                    providesApi: isProvider ? [`Api500`] : [] 
                } 
            }));
        }
    });

    bench("API Discovery: 10 plugins (x100k)", async () => {
        for (let i = 0; i < ITERATIONS; i++) {
            await tractor10.plugins.findByApi("MyApi");
        }
    });

    bench("API Discovery: 1000 plugins (Last) (x100k)", async () => {
        for (let i = 0; i < ITERATIONS; i++) {
            await tractor1000Last.plugins.findByApi("MyApi");
        }
    });

    bench("API Discovery: 1000 plugins (Middle) (x100k)", async () => {
        for (let i = 0; i < ITERATIONS; i++) {
            await tractor1000Random.plugins.findByApi("Api500");
        }
    });
});
