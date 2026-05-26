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
    MODEL_CREDENTIAL_ENV_KEYS,
    MODEL_PROVIDERS,
    MODEL_SCOPES,
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
export function normalizePluginId(pluginId: string): string;
export function isPiAgentPluginId(pluginId: string): boolean;
export type {
    PackageCommandString,
    PackageBinaryCommand,
    PackageManagerName,
    PackageManagerOverrideDiagnostic,
    PackageManagerOptions,
    PackageScriptCommand,
    PackageScriptCommandOptions,
} from "./package-manager.js";
export {
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
export type {
    WorkspacePackageOptions,
} from "./workspace.js";
export {
    affectedWorkspacePackagesFromGitStatus,
    changedFilePathsFromGitStatus,
    findWorkspacePackageForPath,
} from "./workspace.js";

export function findRefarmRoot(startDir?: string): string;
export function loadConfig(root?: string): any;
export function loadConfigAsync(root?: string): Promise<any>;

declare const _default: {
    findRefarmRoot: typeof findRefarmRoot;
    loadConfig: typeof loadConfig;
    loadConfigAsync: typeof loadConfigAsync;
};
export default _default;
