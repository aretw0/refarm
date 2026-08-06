export type {
    ModelCredentialStatus,
    ModelCredentialSource,
    ModelCredentialTokens,
    EffectiveModelRoute,
    ModelRef,
    ModelRouteTokens,
    ModelScope,
    ResolvedModelRef,
} from "./model-routing.js";
export {
    DEFAULT_MODEL_PROVIDER,
    MODEL_BASE_URL_ENV_VAR,
    MODEL_CONFIGURED_PROVIDERS_ENV_VAR,
    MODEL_DEFAULT_PROVIDER_ENV_VAR,
    MODEL_CREDENTIAL_ENV_KEYS,
    MODEL_FALLBACK_MODEL_ID_ENV_VAR,
    MODEL_FALLBACK_PROVIDER_ENV_VAR,
    MODEL_ID_ENV_VAR,
    MODEL_PROFILE_ENV_VAR,
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
export const AGENT_PLUGIN_ID: "@refarm/agent";
export const AGENT_NPM_PACKAGE: "@refarm.dev/agent";
export const RUNTIME_AGENT_PLUGIN_ID: typeof AGENT_PLUGIN_ID;
export const RUNTIME_AGENT_NPM_PACKAGE: typeof AGENT_NPM_PACKAGE;
export interface BundledPluginDescriptor {
    readonly id: string;
    readonly npmPackage: string;
    readonly workspaceDir: string;
    readonly wasmFile: string;
    readonly manifestFile: string;
    readonly requiredProvides: readonly string[];
}
export const RUNTIME_AGENT_PLUGIN_DESCRIPTOR: BundledPluginDescriptor;
export const BUNDLED_PLUGIN_DESCRIPTORS: readonly BundledPluginDescriptor[];
export interface AgentCoreBundle {
    readonly agent: BundledPluginDescriptor;
    readonly corePlugins: readonly BundledPluginDescriptor[];
}
export const AGENT_CORE_BUNDLE: AgentCoreBundle;
export const RUNTIME_AGENT_ERROR_PREFIXES: readonly string[];
export function normalizePluginId(pluginId: string): string;
export function isAgentPluginId(pluginId: string): boolean;
export function isRuntimeAgentPluginId(pluginId: string): boolean;
export function isRuntimeAgentErrorContent(content: string): boolean;
export function canonicalRuntimeAgentContent(content: string): string;
export type {
    DeclaredEnvironmentCeilingSlice,
    DeclaredEnvironmentCeilingsConfig,
    DeclaredEnvironmentHeavyLanePolicy,
    EnvironmentCeilingEnforcementMode,
    EnvironmentCeilingScope,
    EnvironmentCeilingSliceKind,
    EnvironmentCeilingStatus,
} from "./environment-ceilings.js";
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
export type {
    PackageAuditCommandOptions,
    PackageCommandString,
    PackageBinaryCommand,
    PackageManagerName,
    PackageManagerOverrideDiagnostic,
    PackageManagerOptions,
    PackageScriptCommand,
    PackageScriptCommandOptions,
} from "./package-manager.js";
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
export type {
    WorkspacePackageOptions,
} from "./workspace.js";
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
export type {
    DeclaredWorkspaceBridge,
    DeclaredWorkspaceCache,
    DeclaredWorkspaceConfig,
    DeclaredWorkspaceExecution,
    DeclaredWorkspaceRepository,
    DeclaredWorkspaceRemoteCache,
    DeclaredWorkspaceRemoteCacheEnv,
    WorkspaceExecutionAdapter,
    WorkspaceKind,
    WorkspaceRemoteCacheProvider,
} from "./workspaces-config.js";
export {
    WORKSPACE_NAMESPACE_ACCESS,
    WORKSPACE_NAMESPACE_PERSISTENCE,
    declaredWorkspaceNamespaceFromConfig,
    declaredWorkspaceNamespacesFromConfig,
    parseWorkspaceNamespaceAccess,
    parseWorkspaceNamespacePersistence,
} from "./workspace-namespaces-config.js";
export type {
    DeclaredWorkspaceNamespaceConfig,
    WorkspaceNamespaceAccess,
    WorkspaceNamespacePersistence,
} from "./workspace-namespaces-config.js";
export {
    affectedWorkspacePackagesFromChangedPaths,
    affectedWorkspacePackagesFromGitStatus,
    changedFilePathsFromGitNameOnly,
    changedFilePathsFromGitStatus,
    findWorkspacePackageForPath,
    findWorkspaceRoot,
    hasWorkspaceRootMarker,
} from "./workspace.js";

export function findSovereignRoot(startDir?: string): string;
export const REFARM_CONFIG_LEGACY_FILE_NAME: string;

/** The neutral, brand-free env var naming the sovereign config directory (the app
 * sets it, e.g. ".refarm"). No substrate default — the app owns the name. */
export const SOVEREIGN_DIR_SELECTOR_KEY: "SOVEREIGN_DIR";
/** Names WHERE this node's declarations live — the directory containing the sovereign dir. */
export const SOVEREIGN_BASE_KEY: "SOVEREIGN_BASE";
/** The base declarations resolve against: what the node was told, else the process directory. */
export function declaredBase(env?: Record<string, string | undefined>, cwd?: string): string;
/** The config file name inside the sovereign config dir (fixed substrate convention). */
export const CONFIG_FILE_NAME: "config.json";
/** Thrown when the sovereign config dir selector is unset (no substrate default). */
export class MissingSovereignDirError extends Error {}
/** Resolve the sovereign config dir from the selector env; throws if unset. */
export function sovereignDir(env?: Record<string, string | undefined>): string;
/** The `<configDir>/config.json` relative path, dir resolved from the selector env. */
export function sovereignConfigRelativePath(env?: Record<string, string | undefined>): string;
export function sovereignConfigPathCandidates(
	root: string,
	env?: Record<string, string | undefined>,
): string[];
export function defaultSovereignConfigPath(
	root: string,
	env?: Record<string, string | undefined>,
): string;
export function findSovereignConfigPath(
	root: string,
	env?: Record<string, string | undefined>,
): string | null;

/** The neutral bootstrap key that names the env-var prefix (brand-free). */
export const ENV_PREFIX_SELECTOR_KEY: "SOVEREIGN_ENV_PREFIX";
/** The default env-var prefix when none is selected. */
export const DEFAULT_ENV_PREFIX: "REFARM";
/** Derive a normalized env-var prefix from a brand/product name. */
export function envPrefixFromBrand(name: string): string;
/** Resolve the active env-var prefix (explicit → selector env → default). */
export function resolveEnvPrefix(
    explicit?: string,
    env?: NodeJS.ProcessEnv,
): string;

/** Options for the config loaders. */
export interface LoadConfigOptions {
    /** White-label env-var prefix (default resolved via {@link resolveEnvPrefix}). */
    envPrefix?: string;
}
export function loadConfig(root?: string, options?: LoadConfigOptions): any;
export function loadConfigAsync(
    root?: string,
    options?: LoadConfigOptions,
): Promise<any>;

declare const _default: {
    findSovereignRoot: typeof findSovereignRoot;
    sovereignConfigPathCandidates: typeof sovereignConfigPathCandidates;
    defaultSovereignConfigPath: typeof defaultSovereignConfigPath;
    findSovereignConfigPath: typeof findSovereignConfigPath;
    loadConfig: typeof loadConfig;
    loadConfigAsync: typeof loadConfigAsync;
};
export default _default;

// Config-node contract re-exported from the package root (see index.js).
export type {
    ConfigNodeV1,
    ConfigNodeOptions,
    ConfigNodeEvidence,
    RedactedConfigResult,
} from "./config-node.js";
export {
    createConfigNode,
    configFromNode,
    loadRawSovereignConfig,
    loadConfigNode,
    loadConfigNodeAsync,
    CONFIG_NODE_SCHEMA,
    CONFIG_NODE_KIND,
    CONFIG_NODE_DEFAULT_ID,
} from "./config-node.js";
