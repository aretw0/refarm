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
	RUNTIME_SUBSCRIPTION_MODEL_PROVIDERS,
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
	isRuntimeSubscriptionModelProvider,
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
	AGENT_CORE_BUNDLE,
	AGENT_NPM_PACKAGE,
	AGENT_PLUGIN_ID,
	BUNDLED_PLUGIN_DESCRIPTORS,
	LSP_CODE_OPS_PLUGIN_DESCRIPTOR,
	RUNTIME_AGENT_ERROR_PREFIXES,
	RUNTIME_AGENT_NPM_PACKAGE,
	RUNTIME_AGENT_PLUGIN_DESCRIPTOR,
	RUNTIME_AGENT_PLUGIN_ID,
	canonicalRuntimeAgentContent,
	isRuntimeAgentErrorContent,
	isAgentPluginId,
	isRuntimeAgentPluginId,
	normalizePluginId,
} from "./plugin-identity.js";
export {
	ENVIRONMENT_CEILING_ENFORCEMENT_MODES,
	ENVIRONMENT_CEILING_SCOPES,
	ENVIRONMENT_CEILING_SLICE_KINDS,
	ENVIRONMENT_CEILING_STATUSES,
	declaredEnvironmentCeilingsFromConfig,
	parseEnvironmentCeilingEnforcementMode,
	parseEnvironmentCeilingScope,
	parseEnvironmentCeilingSliceKind,
	parseEnvironmentCeilingStatus,
} from "./environment-ceilings.js";
export {
	PACKAGE_MANAGER_OVERRIDE_ENV_VAR,
	PACKAGE_MANAGERS,
	createPackageScriptCommand,
	detectPackageManager,
	packageAddDevCommand,
	packageAuditCommand,
	packageAuditHighCommand,
	packageBinaryCommand,
	packageFrozenInstallCommand,
	packageInstallCommand,
	packageManagerOverrideDiagnostic,
	packagePublishDryRunCommand,
	packageScriptCommand,
	packageWorkspacePublishDryRunCommand,
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
	WORKSPACE_NAMESPACE_ACCESS,
	WORKSPACE_NAMESPACE_PERSISTENCE,
	declaredWorkspaceNamespaceFromConfig,
	declaredWorkspaceNamespacesFromConfig,
	parseWorkspaceNamespaceAccess,
	parseWorkspaceNamespacePersistence,
} from "./workspace-namespaces-config.js";
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

// --- Sovereign config directory (injected, no substrate default) ---
//
// The substrate does NOT know the config directory name. Like a config binary that
// "fails up" (the `applicationCommand` precedent below, and unlike the env-prefix
// which has a resolved default), the dir is SELECTED by the host/app through a
// neutral, brand-free env var and the substrate reads it with NO fallback: an unset
// selector fails loudly rather than silently landing on a brand name. Only the app
// (apps/refarm) sets `.refarm`; the Rust host reads the SAME env var, so the two
// stacks agree on the path without either hardcoding it (the RS↔TS lockstep, now
// via injection instead of a duplicated literal). Mirrors storage-fs's
// MissingOrgRootError: no default means an accidental unset is a clear error.

/** The neutral, brand-free env var that names the sovereign DIRECTORY (e.g.
 * the app sets it to ".refarm"). No default in the substrate — the app owns the name. */
export const SOVEREIGN_DIR_SELECTOR_KEY = "SOVEREIGN_DIR";

/** The config file name inside the sovereign config dir. This IS a fixed substrate
 * convention (the file, not the branded dir), and matches the Rust host. */
export const CONFIG_FILE_NAME = "config.json";

/** Thrown when the sovereign dir is not injected — the substrate has no default,
 * so an unset selector is a loud error, not a silent brand fallback. */
export class MissingSovereignDirError extends Error {
	constructor() {
		super(
			`The sovereign directory has no substrate default — set ${SOVEREIGN_DIR_SELECTOR_KEY} ` +
				`(the app chooses it, e.g. ".refarm"). The substrate never hardcodes a brand dir.`,
		);
		this.name = "MissingSovereignDirError";
	}
}

/** Resolve the sovereign config dir name from the neutral selector env. NO fallback:
 * throws MissingSovereignDirError when unset. */
export function sovereignDir(env = process.env) {
	const dir = env[SOVEREIGN_DIR_SELECTOR_KEY]?.trim();
	if (!dir) throw new MissingSovereignDirError();
	return dir;
}

/** The canonical `<configDir>/config.json` RELATIVE path, resolving the dir from the
 * injected selector. Replaces the old hardcoded REFARM_CONFIG_CANONICAL_RELATIVE_PATH. */
export function sovereignConfigRelativePath(env = process.env) {
	return path.join(sovereignDir(env), CONFIG_FILE_NAME);
}

export const REFARM_CONFIG_LEGACY_FILE_NAME = "refarm.config.json";

// --- Env-var prefix (white-label seam, ADR-087 phase 4) ---
//
// The env source below reads `<PREFIX>_SITE_URL`, `<PREFIX>_SCOPE_*`,
// `<PREFIX>_PROVIDER_*`, etc. The prefix is NOT hardcoded to the brand — it is
// resolved. This mirrors the `<BINARY>_COMMAND` override precedent in
// `@refarm.dev/cli` (`command-handoff.ts`): a name derives a namespace, the host
// may override it, and there is a documented default.

/** The neutral bootstrap key that names the env-var prefix — deliberately
 * brand-free (the repo's own "sovereign" architectural term, not a product), so a
 * white-label can select its prefix without the upstream brand leaking into the
 * selector itself. */
export const ENV_PREFIX_SELECTOR_KEY = "SOVEREIGN_ENV_PREFIX";

/** The default env-var prefix when none is selected. Env-prefix is the ONE brand
 * dimension with a resolved default (per the white-label doctrine: "não é 'sempre
 * REFARM' nem 'tira o refarm' — é config resolvida"), distinct from the CLI binary
 * which fails up. Keeps every existing `REFARM_*` caller working. */
export const DEFAULT_ENV_PREFIX = "REFARM";

/** Derive a normalized env-var prefix from a brand/product name.
 * `"refarm"` → `"REFARM"`, `"acme labs"` → `"ACME_LABS"`. Mirrors
 * `applicationCommandOverrideEnv`'s `toUpperCase().replace(/[^A-Z0-9]+/g,"_")`. */
export function envPrefixFromBrand(name) {
	return String(name)
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

/** Resolve the active env-var prefix: an explicit prefix wins; otherwise the
 * neutral selector env; otherwise the default. Never reads a brand-named env to
 * decide the prefix (that would be the chicken-and-egg the doctrine rejects). */
export function resolveEnvPrefix(explicit, env = process.env) {
	if (explicit && String(explicit).trim().length > 0) return envPrefixFromBrand(explicit);
	const selected = env[ENV_PREFIX_SELECTOR_KEY]?.trim();
	if (selected && selected.length > 0) return envPrefixFromBrand(selected);
	return DEFAULT_ENV_PREFIX;
}

export function sovereignConfigPathCandidates(root, env = process.env) {
	return [
		path.join(root, sovereignConfigRelativePath(env)),
		path.join(root, REFARM_CONFIG_LEGACY_FILE_NAME),
	];
}

export function defaultSovereignConfigPath(root, env = process.env) {
	return path.join(root, sovereignConfigRelativePath(env));
}

export function findSovereignConfigPath(root, env = process.env) {
	return (
		sovereignConfigPathCandidates(root, env).find((candidate) => fs.existsSync(candidate)) ?? null
	);
}

/**
 * Helper to find the root directory of the monorepo.
 */
export function findSovereignRoot(startDir = process.cwd()) {
	let currentDir = startDir;
	while (true) {
		if (findSovereignConfigPath(currentDir)) return currentDir;
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
	if (Array.isArray(source)) return [...source];
	if (Array.isArray(target)) return source;
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
		return current.map((item) => resolveInterpolation(config, item));
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
		let config = {};
		for (const configPath of [...sovereignConfigPathCandidates(root)].reverse()) {
			if (!fs.existsSync(configPath)) continue;
			try {
				config = deepMerge(config, JSON.parse(fs.readFileSync(configPath, "utf-8")));
			} catch (e) {
				console.warn(`[refarm/config] Failed to parse JSON at ${configPath}`);
			}
		}
		return config;
	},
};

const EnvSource = {
	name: "env",
	// `prefix` is the resolved env-var namespace (default "REFARM"). Reading it as
	// a parameter — not a hardcoded literal — is what makes the mapping agnostic:
	// a white-label sets its prefix and gets `<PREFIX>_SITE_URL`, `<PREFIX>_SCOPE_*`
	// and `<PREFIX>_PROVIDER_*` for free.
	loadSync(prefix = DEFAULT_ENV_PREFIX) {
		// Map common <PREFIX>_ envs to the config structure
		const config = {};
		const SITE_URL = `${prefix}_SITE_URL`;
		const REPO_URL = `${prefix}_REPO_URL`;
		const GIT_HOST = `${prefix}_GIT_HOST`;
		const SCOPE_PREFIX = `${prefix}_SCOPE_`;
		const PROVIDER_PREFIX = `${prefix}_PROVIDER_`;
		if (process.env[SITE_URL] || process.env[REPO_URL]) {
			config.brand = { urls: {} };
			if (process.env[SITE_URL]) config.brand.urls.site = process.env[SITE_URL];
			if (process.env[REPO_URL]) config.brand.urls.repository = process.env[REPO_URL];
		}
		if (process.env[GIT_HOST]) {
			config.infrastructure = { gitHost: process.env[GIT_HOST] };
		}
		// Support for dynamic scopes from env
		for (const [key, value] of Object.entries(process.env)) {
			if (key.startsWith(SCOPE_PREFIX)) {
				const scopeKey = key.slice(SCOPE_PREFIX.length).toLowerCase();
				config.brand = config.brand || {};
				config.brand.scopes = config.brand.scopes || {};
				config.brand.scopes[scopeKey] = value;
			}
		}
		// <PREFIX>_PROVIDER_<ID>_<KEY> → providers.<id>.<camelKey>
		// e.g. REFARM_PROVIDER_GITHUB_CLIENT_ID → providers.github.clientId
		for (const [key, value] of Object.entries(process.env)) {
			if (!key.startsWith(PROVIDER_PREFIX)) continue;
			const rest = key.slice(PROVIDER_PREFIX.length); // GITHUB_CLIENT_ID
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
	},
};

const RemoteSource = {
	name: "remote",
	/**
	 * Implement full Sovereign Graph / External API resolution.
	 */
	async load(root, endpoint, envPrefix = DEFAULT_ENV_PREFIX) {
		if (!endpoint) return {};

		const token = process.env[`${envPrefix}_REMOTE_TOKEN`];
		const headers = {
			Accept: "application/json",
			"X-Refarm-Client": "config-loader",
		};

		if (token) {
			headers["Authorization"] = `Bearer ${token}`;
		}

		try {
			console.log(`📡 [refarm/config] Fetching remote config from ${endpoint}...`);
			const res = await fetch(endpoint, {
				headers,
				signal: AbortSignal.timeout(15_000),
			});

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
	},
};

/**
 * STRATEGIC BOOTSTRAP
 * Decides the activation strategy based on signals.
 * @param {string} root
 * @returns {object}
 */
function bootstrapIntent(root, envPrefix = DEFAULT_ENV_PREFIX) {
	const json = JsonSource.loadSync(root);
	const env = EnvSource.loadSync(envPrefix);

	// Signals
	const ephemeralEndpoint = process.env[`${envPrefix}_EPHEMERAL_SOURCE`];
	const persistentEndpoint =
		env.infrastructure?.remote?.endpoint || json.infrastructure?.remote?.endpoint;

	if (ephemeralEndpoint) {
		return {
			strategy: "ephemeral", // TODO: Use strategy to adjust logging level
			endpoint: ephemeralEndpoint,
			precedence: ["json", "env", "remote"],
		};
	}

	if (persistentEndpoint) {
		return {
			strategy: "persistent", // TODO: Add schema validation for persistent mode
			endpoint: persistentEndpoint,
			precedence: ["json", "remote", "env"],
		};
	}

	return { strategy: "static", precedence: ["json", "env"] };
}

/**
 * Synchronous loader (JSON + ENV)
 * @param {string} [root] monorepo root
 * @param {{ envPrefix?: string }} [options] white-label env-var prefix (default "REFARM")
 */
export function loadConfig(root = findSovereignRoot(), options = {}) {
	const envPrefix = resolveEnvPrefix(options.envPrefix);
	const { precedence } = bootstrapIntent(root, envPrefix);
	let config = {};

	const sources = {
		json: () => JsonSource.loadSync(root),
		env: () => EnvSource.loadSync(envPrefix),
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
 * @param {string} [root] monorepo root
 * @param {{ envPrefix?: string }} [options] white-label env-var prefix (default "REFARM")
 */
export async function loadConfigAsync(root = findSovereignRoot(), options = {}) {
	const envPrefix = resolveEnvPrefix(options.envPrefix);
	const { endpoint, precedence } = bootstrapIntent(root, envPrefix);
	let config = {};

	const sources = {
		json: () => JsonSource.loadSync(root),
		env: () => EnvSource.loadSync(envPrefix),
		remote: async () => (endpoint ? await RemoteSource.load(root, endpoint, envPrefix) : {}),
	};

	for (const sourceKey of precedence) {
		const data = await sources[sourceKey]();
		config = deepMerge(config, data);
	}

	return resolveInterpolation(config);
}

export default {
	findSovereignRoot,
	sovereignConfigPathCandidates,
	defaultSovereignConfigPath,
	findSovereignConfigPath,
	loadConfig,
	loadConfigAsync,
};

// Re-export the config-node contract from the package root so consumers (and
// test runners that don't honor the "./config-node" subpath export) can import
// createConfigNode/configFromNode/loadRawSovereignConfig/CONFIG_NODE_DEFAULT_ID
// from "@refarm.dev/config" directly. The cycle (config-node imports loadConfig
// from here) is safe: config-node only calls loadConfig inside functions, never
// at module init.
export {
	CONFIG_NODE_SCHEMA,
	CONFIG_NODE_KIND,
	CONFIG_NODE_DEFAULT_ID,
	createConfigNode,
	configFromNode,
	loadRawSovereignConfig,
	loadConfigNode,
	loadConfigNodeAsync,
} from "./config-node.js";
