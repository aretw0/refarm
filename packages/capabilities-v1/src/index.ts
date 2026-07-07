export {
	createSourceCapabilityGroup,
	defaultSourceDeps,
	type SourceCommandDeps,
} from "./source-capability.js";
export {
	createRecordsCapabilityGroup,
	defaultRecordsDeps,
	type RecordsCommandDeps,
} from "./records-capability.js";
export {
	createVaultCapabilityGroup,
	defaultVaultDeps,
	type VaultCommandDeps,
} from "./vault-capability.js";
export type {
	VaultDiscoveryResult,
	VaultProviderSummary,
} from "./vault-discovery-types.js";
export {
	refarmBuiltinCapabilities,
	type RefarmCapabilityDeps,
} from "./builtin-capabilities.js";
export {
	buildDispatchEffort,
	parseDispatchArgs,
	pluginDescriptorsFrom,
	registerPluginCapabilities,
	type DispatchRequest,
	type PluginCapabilityRegistration,
	type PluginDescriptorDeps,
	type SubmitEffort,
	type SurfaceableManifest,
} from "./plugin-bridge.js";
export {
	mountCapabilities,
	mountedCliCommands,
	mountedHttpHandler,
	serveCapabilities,
	type MountOptions,
} from "./mount.js";
export {
	createWasmSourceProvider,
	type CallRespond,
	type WasmSourceProviderOptions,
} from "./wasm-source-provider.js";
