export type { ModelScope } from "./model-routing.js";
export {
    DEFAULT_MODEL_PROVIDER,
    MODEL_PROVIDERS,
    MODEL_SCOPES,
    defaultModelForProvider,
    defaultModelForScope,
    inferProviderFromModelId,
    isModelProvider,
    isModelScope,
} from "./model-routing.js";
export const PI_AGENT_PLUGIN_ID: "@refarm/pi-agent";
export const PI_AGENT_NPM_PACKAGE: "@refarm.dev/pi-agent";
export function normalizePluginId(pluginId: string): string;
export function isPiAgentPluginId(pluginId: string): boolean;
export type {
    PackageCommandString,
    PackageBinaryCommand,
    PackageManagerName,
    PackageManagerOptions,
    PackageScriptCommand,
    PackageScriptCommandOptions,
} from "./package-manager.js";
export {
    PACKAGE_MANAGERS,
    createPackageScriptCommand,
    detectPackageManager,
    packageBinaryCommand,
    packageInstallCommand,
    packagePublishDryRunCommand,
    packageScriptCommand,
    parsePackageManager,
} from "./package-manager.js";

export function findRefarmRoot(startDir?: string): string;
export function loadConfig(root?: string): any;
export function loadConfigAsync(root?: string): Promise<any>;

declare const _default: {
    findRefarmRoot: typeof findRefarmRoot;
    loadConfig: typeof loadConfig;
    loadConfigAsync: typeof loadConfigAsync;
};
export default _default;
