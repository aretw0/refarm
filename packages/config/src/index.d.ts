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
export const PI_AGENT_PLUGIN_ID: "@refarm/pi-agent";
export const PI_AGENT_NPM_PACKAGE: "@refarm.dev/pi-agent";
export const RUNTIME_AGENT_PLUGIN_ID: typeof PI_AGENT_PLUGIN_ID;
export const RUNTIME_AGENT_NPM_PACKAGE: typeof PI_AGENT_NPM_PACKAGE;
export const RUNTIME_AGENT_ERROR_PREFIXES: readonly string[];
export function normalizePluginId(pluginId: string): string;
export function isPiAgentPluginId(pluginId: string): boolean;
export function isRuntimeAgentPluginId(pluginId: string): boolean;
export function isRuntimeAgentErrorContent(content: string): boolean;
export function canonicalRuntimeAgentContent(content: string): string;
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
    affectedWorkspacePackagesFromChangedPaths,
    affectedWorkspacePackagesFromGitStatus,
    changedFilePathsFromGitNameOnly,
    changedFilePathsFromGitStatus,
    findWorkspacePackageForPath,
    findWorkspaceRoot,
} from "./workspace.js";

export function findRefarmRoot(startDir?: string): string;
export const REFARM_CONFIG_CANONICAL_RELATIVE_PATH: string;
export const REFARM_CONFIG_LEGACY_FILE_NAME: string;
export function refarmConfigPathCandidates(root: string): string[];
export function defaultRefarmConfigPath(root: string): string;
export function findRefarmConfigPath(root: string): string | null;
export function loadConfig(root?: string): any;
export function loadConfigAsync(root?: string): Promise<any>;

declare const _default: {
    findRefarmRoot: typeof findRefarmRoot;
    refarmConfigPathCandidates: typeof refarmConfigPathCandidates;
    defaultRefarmConfigPath: typeof defaultRefarmConfigPath;
    findRefarmConfigPath: typeof findRefarmConfigPath;
    loadConfig: typeof loadConfig;
    loadConfigAsync: typeof loadConfigAsync;
};
export default _default;
