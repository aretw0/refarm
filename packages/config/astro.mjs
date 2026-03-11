import { defineConfig as defineAstroConfig } from "astro/config";
import fs from "fs";
import path from "path";

// Helper to look for refarm.config.json by walking up the directory tree
function findRefarmConfig() {
    let currentDir = process.cwd();
    while (true) {
        const configPath = path.join(currentDir, "refarm.config.json");
        if (fs.existsSync(configPath)) {
            try {
                return JSON.parse(fs.readFileSync(configPath, "utf-8"));
            } catch (e) {
                return {};
            }
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break; // Reached FS root
        currentDir = parentDir;
    }
    return {};
}

/**
 * Wraps the standard Astro defineConfig with Refarm's monorepo defaults.
 * It automatically reads `refarm.config.json` and injects required headers for WebContainers.
 */
export function defineConfig(userConfig = {}) {
    const refarmConfig = findRefarmConfig();

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
