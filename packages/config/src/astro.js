import { defineConfig as defineAstroConfig } from "astro/config";
import path from "node:path";
import wasm from "vite-plugin-wasm";

import { findRefarmRoot, loadConfig } from "./index.js";

/**
 * Wraps the standard Astro defineConfig with Refarm's monorepo defaults.
 * It automatically reads `refarm.config.json` and injects required headers for WebContainers.
 */
export function defineConfig(userConfig = {}) {
    const root = findRefarmRoot(); 
    const refarmConfig = loadConfig(root);

    // Base path configuration for Pages deployment
    const site = process.env.ASTRO_SITE || refarmConfig?.brand?.urls?.site || undefined;
    const base = process.env.ASTRO_BASE || (process.env.NODE_ENV === 'production' && refarmConfig?.brand?.slug ? `/${refarmConfig.brand.slug}/` : '/');

    // Manually define core aliases for robust resolution in monorepo
    const coreAliases = {
        "@refarm.dev/homestead/sdk": path.resolve(root, "packages/homestead/src/sdk/index.ts"),
        "@refarm.dev/homestead/ui": path.resolve(root, "packages/homestead/src/ui/index.ts"),
        "@refarm.dev/tractor": path.resolve(root, "packages/tractor-ts/src/index.ts"),
        "@refarm.dev/config": path.resolve(root, "packages/config/src/index.js"),
        "@refarm.dev/ds/styles/tokens.css": path.resolve(root, "packages/ds/src/tokens.css"),
        "@refarm.dev/ds/styles/styles.css": path.resolve(root, "packages/ds/src/styles.css"),
        "@refarm.dev/locales": path.resolve(root, "locales")
    };

    // Safely merge configurations
    const mergedConfig = {
        site,
        base,
        output: "static",
        ...userConfig,
        server: {
            ...(userConfig.server || {}),
            headers: {
                "Cross-Origin-Opener-Policy": "same-origin",
                "Cross-Origin-Embedder-Policy": "require-corp",
                ...(userConfig.server?.headers || {})
            }
        },
        vite: {
            ...(userConfig.vite || {}),
            plugins: [
                wasm(),
                ...(userConfig.vite?.plugins || [])
            ],
            ssr: {
                noExternal: ["@refarm.dev/homestead", "@refarm.dev/tractor", "@refarm.dev/config"],
                ...(userConfig.vite?.ssr || {}),
                external: [
                    "node:fs",
                    "node:path",
                    "node:os",
                    "isomorphic-git",
                    "@bytecodealliance/jco",
                    ...(userConfig.vite?.ssr?.external || [])
                ]
            },
            resolve: {
                ...(userConfig.vite?.resolve || {}),
                extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.astro'],
                alias: {
                    ...coreAliases,
                    ...(userConfig.vite?.resolve?.alias || {})
                }
            },
            optimizeDeps: {
                ...(userConfig.vite?.optimizeDeps || {}),
                exclude: [
                    "@sqlite.org/sqlite-wasm",
                    "loro-crdt",
                    ...(userConfig.vite?.optimizeDeps?.exclude || [])
                ]
            },
            worker: {
                format: "es",
                ...(userConfig.vite?.worker || {})
            }
        }
    };

    return defineAstroConfig(mergedConfig);
}

// Allow default imports as well
export default { defineConfig };
