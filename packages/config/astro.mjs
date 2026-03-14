import { defineConfig as defineAstroConfig } from "astro/config";
import fs from "fs";
import path from "path";

import { findRefarmRoot, loadConfig } from "./index.mjs";

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
            resolve: {
                ...(userConfig.vite?.resolve || {}),
                alias: {
                    "@refarm.dev/locales": path.resolve(root, "locales"),
                    ...(userConfig.vite?.resolve?.alias || {})
                }
            },
            optimizeDeps: {
                ...(userConfig.vite?.optimizeDeps || {}),
                exclude: [
                    "@sqlite.org/sqlite-wasm",
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
