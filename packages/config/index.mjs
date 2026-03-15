import fs from "node:fs";
import path from "node:path";

/**
 * Common configuration utility for Refarm.
 * Implements a pluggable source system with Strategic Bootstrap and prioritized merging.
 */

export function findRefarmRoot(startDir = process.cwd()) {
    let currentDir = startDir;
    while (true) {
        const configPath = path.join(currentDir, "refarm.config.json");
        if (fs.existsSync(configPath)) return currentDir;
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
    }
    return process.cwd();
}

/**
 * Deep merge utility for configuration objects
 */
function deepMerge(target, source) {
    if (!source) return target;
    const output = { ...target };

    for (const key of Object.keys(source)) {
        if (source[key] instanceof Object && key in target) {
            output[key] = deepMerge(target[key], source[key]);
        } else {
            output[key] = source[key];
        }
    }
    return output;
}

/**
 * Simple interpolation resolver for config properties.
 * Supports {{path.to.prop}} and {{env.VAR_NAME}}.
 */
function resolveInterpolation(config, current = config) {
    if (typeof current === "string") {
        return current.replace(/\{\{([\w\.]+)\}\}/g, (match, path) => {
            if (path.startsWith("env.")) {
                const envVar = path.slice(4);
                return process.env[envVar] || match;
            }

            // Traverse config
            const parts = path.split(".");
            let val = config;
            for (const part of parts) {
                val = val?.[part];
                if (val === undefined) break;
            }

            return val !== undefined ? String(val) : match;
        });
    }

    if (Array.isArray(current)) {
        return current.map(item => resolveInterpolation(config, item));
    }

    if (current !== null && typeof current === "object") {
        const resolved = {};
        for (const [key, value] of Object.entries(current)) {
            resolved[key] = resolveInterpolation(config, value);
        }
        return resolved;
    }

    return current;
}

// --- Sources ---

const JsonSource = {
    name: "json",
    loadSync(root) {
        const configPath = path.join(root, "refarm.config.json");
        if (!fs.existsSync(configPath)) return {};
        try {
            return JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch (e) {
            console.warn(`[refarm/config] Failed to parse JSON at ${configPath}`);
            return {};
        }
    }
};

const EnvSource = {
    name: "env",
    loadSync() {
        // Map common REFARM_ envs to the config structure
        const config = {};
        if (process.env.REFARM_SITE_URL || process.env.REFARM_REPO_URL) {
            config.brand = { urls: {} };
            if (process.env.REFARM_SITE_URL) config.brand.urls.site = process.env.REFARM_SITE_URL;
            if (process.env.REFARM_REPO_URL) config.brand.urls.repository = process.env.REFARM_REPO_URL;
        }
        if (process.env.REFARM_GIT_HOST) {
            config.infrastructure = { gitHost: process.env.REFARM_GIT_HOST };
        }
        // Support for dynamic scopes from env
        for (const [key, value] of Object.entries(process.env)) {
            if (key.startsWith("REFARM_SCOPE_")) {
                const scopeKey = key.replace("REFARM_SCOPE_", "").toLowerCase();
                config.brand = config.brand || {};
                config.brand.scopes = config.brand.scopes || {};
                config.brand.scopes[scopeKey] = value;
            }
        }
        return config;
    }
};

const RemoteSource = {
    name: "remote",
    /**
     * Implement full Sovereign Graph / External API resolution.
     */
    async load(root, endpoint) {
        if (!endpoint) return {};
        
        try {
            const res = await fetch(endpoint, {
                headers: {
                    "Accept": "application/json",
                    "X-Refarm-Client": "config-loader"
                }
            });
            
            if (!res.ok) {
                console.warn(`[refarm/config] Remote source failed: ${res.status} ${res.statusText}`);
                return {};
            }
            
            return await res.json();
        } catch (e) {
            console.warn(`[refarm/config] Remote source error at ${endpoint}: ${e.message}`);
            return {};
        }
    }
};

/**
 * STRATEGIC BOOTSTRAP
 * Decides the activation strategy based on signals.
 */
function bootstrapIntent(root) {
    const json = JsonSource.loadSync(root);
    const env = EnvSource.loadSync();

    // Signals
    const ephemeralEndpoint = process.env.REFARM_EPHEMERAL_SOURCE;
    const persistentEndpoint = env.infrastructure?.remote?.endpoint || json.infrastructure?.remote?.endpoint;

    if (ephemeralEndpoint) {
        return {
            strategy: "ephemeral", // TODO: Use strategy to adjust logging level
            endpoint: ephemeralEndpoint,
            precedence: ["json", "env", "remote"]
        };
    }

    if (persistentEndpoint) {
        return {
            strategy: "persistent", // TODO: Add schema validation for persistent mode
            endpoint: persistentEndpoint,
            precedence: ["json", "remote", "env"]
        };
    }

    return { strategy: "static", precedence: ["json", "env"] };
}

/**
 * Synchronous loader (JSON + ENV)
 */
export function loadConfig(root = findRefarmRoot()) {
    const { strategy, precedence } = bootstrapIntent(root);
    let config = {};

    const sources = {
        json: () => JsonSource.loadSync(root),
        env: () => EnvSource.loadSync()
    };

    for (const sourceKey of precedence) {
        if (sources[sourceKey]) {
            config = deepMerge(config, sources[sourceKey]());
        }
    }

    return resolveInterpolation(config);
}

/**
 * Asynchronous loader (Full Sovereignty)
 */
export async function loadConfigAsync(root = findRefarmRoot()) {
    const { strategy, endpoint, precedence } = bootstrapIntent(root);
    let config = {};

    const sources = {
        json: () => JsonSource.loadSync(root),
        env: () => EnvSource.loadSync(),
        remote: async () => endpoint ? await RemoteSource.load(root, endpoint) : {}
    };

    for (const sourceKey of precedence) {
        const data = await sources[sourceKey]();
        config = deepMerge(config, data);
    }

    return resolveInterpolation(config);
}

export default { findRefarmRoot, loadConfig, loadConfigAsync };
