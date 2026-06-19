import fs from "node:fs";
import path from "node:path";
export {
    DEFAULT_MODEL_PROVIDER,
    MODEL_BASE_URL_ENV_VAR,
    MODEL_DEFAULT_PROVIDER_ENV_VAR,
    MODEL_CREDENTIAL_ENV_KEYS,
    MODEL_FALLBACK_MODEL_ID_ENV_VAR,
    MODEL_FALLBACK_PROVIDER_ENV_VAR,
    MODEL_ID_ENV_VAR,
    MODEL_PROVIDER_ENV_VAR,
    MODEL_PROVIDERS,
    MODEL_ROUTE_ENV_VARS,
    MODEL_RUNTIME_ENV_VARS,
    MODEL_SCOPES,
    SUBSCRIPTION_MODEL_PROVIDERS,
    defaultProviderModelId,
    defaultProviderModelRef,
    effectiveModelRouteForScope,
    defaultModelForProvider,
    defaultModelForScope,
    defaultScopedModelRef,
    formatModelRef,
    inferProviderFromModelId,
    hasUsableModelCredential,
    hasUsableModelCredentialSource,
    isModelProvider,
    isModelScope,
    isSubscriptionModelProvider,
    modelCredentialStatus,
    modelCredentialEnvKey,
    modelCredentialSource,
    modelOAuthCredential,
    modelRouteTokenUpdate,
    parseModelScope,
    parseModelRef,
} from "./model-routing.js";
export {
    PI_AGENT_NPM_PACKAGE,
    PI_AGENT_PLUGIN_ID,
    RUNTIME_AGENT_ERROR_PREFIXES,
    RUNTIME_AGENT_NPM_PACKAGE,
    RUNTIME_AGENT_PLUGIN_ID,
    canonicalRuntimeAgentContent,
    isRuntimeAgentErrorContent,
    isPiAgentPluginId,
    isRuntimeAgentPluginId,
    normalizePluginId,
} from "./plugin-identity.js";
export {
    PACKAGE_MANAGER_OVERRIDE_ENV_VAR,
    PACKAGE_MANAGERS,
    createPackageScriptCommand,
    detectPackageManager,
    packageBinaryCommand,
    packageFrozenInstallCommand,
    packageInstallCommand,
    packageManagerOverrideDiagnostic,
    packagePublishDryRunCommand,
    packageScriptCommand,
    parsePackageManager,
} from "./package-manager.js";
export {
    WORKSPACE_EXECUTION_ADAPTERS,
    WORKSPACE_KINDS,
    WORKSPACE_REMOTE_CACHE_PROVIDERS,
    declaredWorkspaceFromConfig,
    declaredWorkspacesFromConfig,
    parseWorkspaceExecutionAdapter,
    parseWorkspaceKind,
    parseWorkspaceRemoteCacheProvider,
} from "./workspaces-config.js";
export {
    affectedWorkspacePackagesFromChangedPaths,
    affectedWorkspacePackagesFromGitStatus,
    changedFilePathsFromGitNameOnly,
    changedFilePathsFromGitStatus,
    findWorkspacePackageForPath,
    findWorkspaceRoot,
} from "./workspace.js";

/**
 * Common configuration utility for Refarm.
 * Implements a pluggable source system with Strategic Bootstrap and prioritized merging.
 */

export const REFARM_CONFIG_CANONICAL_RELATIVE_PATH = path.join(".refarm", "config.json");
export const REFARM_CONFIG_LEGACY_FILE_NAME = "refarm.config.json";

export function refarmConfigPathCandidates(root) {
    return [
        path.join(root, REFARM_CONFIG_CANONICAL_RELATIVE_PATH),
        path.join(root, REFARM_CONFIG_LEGACY_FILE_NAME),
    ];
}

export function defaultRefarmConfigPath(root) {
    return path.join(root, REFARM_CONFIG_CANONICAL_RELATIVE_PATH);
}

export function findRefarmConfigPath(root) {
    return refarmConfigPathCandidates(root).find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * Helper to find the root directory of the monorepo.
 */
export function findRefarmRoot(startDir = process.cwd()) {
    let currentDir = startDir;
    while (true) {
        if (findRefarmConfigPath(currentDir)) return currentDir;
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
    }
    return process.cwd();
}

/**
 * Deep merge utility for configuration objects
 * @param {object} target
 * @param {object} source
 * @returns {object}
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
 * @param {object} config
 * @param {object} current
 * @returns {object}
 */
function resolveInterpolation(config, current = config) {
    if (typeof current === "string") {
        return current.replace(/\{\{([\w\.]+)\}\}/g, (match, pathStr) => {
            if (pathStr.startsWith("env.")) {
                const envVar = pathStr.slice(4);
                return process.env[envVar] || match;
            }

            // Traverse config
            const parts = pathStr.split(".");
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
        const configPath = findRefarmConfigPath(root);
        if (!configPath) return {};
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
        // REFARM_PROVIDER_<ID>_<KEY> → providers.<id>.<camelKey>
        // e.g. REFARM_PROVIDER_GITHUB_CLIENT_ID → providers.github.clientId
        for (const [key, value] of Object.entries(process.env)) {
            if (!key.startsWith("REFARM_PROVIDER_")) continue;
            const rest = key.slice("REFARM_PROVIDER_".length); // GITHUB_CLIENT_ID
            const underscore = rest.indexOf("_");
            if (underscore === -1) continue;
            const providerId = rest.slice(0, underscore).toLowerCase(); // github
            const fieldRaw = rest.slice(underscore + 1); // CLIENT_ID
            // snake_case → camelCase
            const fieldKey = fieldRaw.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase()); // clientId
            config.providers = config.providers || {};
            config.providers[providerId] = config.providers[providerId] || {};
            config.providers[providerId][fieldKey] = value;
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

        const token = process.env.REFARM_REMOTE_TOKEN;
        const headers = {
            "Accept": "application/json",
            "X-Refarm-Client": "config-loader"
        };

        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        try {
            console.log(`📡 [refarm/config] Fetching remote config from ${endpoint}...`);
            const res = await fetch(endpoint, { headers });

            if (!res.ok) {
                console.warn(`[refarm/config] Remote source failed: ${res.status} ${res.statusText}`);
                return {};
            }

            const data = await res.json();
            return data?.config || data; // Support both wrapped and direct JSON
        } catch (e) {
            console.warn(`[refarm/config] Remote source error at ${endpoint}: ${e.message}`);
            return {};
        }
    }
};

/**
 * STRATEGIC BOOTSTRAP
 * Decides the activation strategy based on signals.
 * @param {string} root
 * @returns {object}
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
    const { precedence } = bootstrapIntent(root);
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
    const { endpoint, precedence } = bootstrapIntent(root);
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

export default {
    findRefarmRoot,
    refarmConfigPathCandidates,
    defaultRefarmConfigPath,
    findRefarmConfigPath,
    loadConfig,
    loadConfigAsync,
};
