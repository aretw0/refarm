export {
	createSourceCapabilityGroup,
	defaultSourceDeps,
	type SourceCommandDeps,
} from "./source-capability.js";
export {
	isCapabilityGroup,
	resolveGroupAction,
	type ResolvedGroupAction,
} from "@refarm.dev/cli/capabilities";
export {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";
export type {
	CapabilityDescriptor,
	CapabilityEntry,
	CapabilityEnvelope,
	CapabilityGroup,
	CapabilityInput,
} from "@refarm.dev/cli/capabilities";
export {
	createRecordsCapabilityGroup,
	defaultRecordsDeps,
	type RecordsCommandDeps,
} from "./records-capability.js";
export {
	createBaseStatusCapability,
	type BaseStatusCapabilityOptions,
} from "./operator-state-capability.js";
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
	defineCapabilityHost,
	type CapabilityHost,
	type CapabilityHostCapabilities,
	type CapabilityHostCapabilitiesFactory,
	type CapabilityHostCapabilityUnitOptions,
	type CapabilityHostDefinition,
	type CapabilityHostOperatorStatus,
	type CapabilityHostRecordReviewQueueUnitOptions,
	type CapabilityHostReviewQueueUnitOptions,
	type CapabilityHostSurfaceAction,
	type CapabilityHostSurfaceActionRow,
	type CapabilityHostSurfaceActionsOptions,
	type CapabilityHostSurfaceContext,
	type CapabilityHostServeCallOptions,
	type CapabilityHostServeOptions,
	type CapabilityHostStatusContext,
} from "./host.js";
export {
	createWasmSourceProvider,
	type CallRespond,
	type WasmSourceProviderOptions,
} from "./wasm-source-provider.js";
export {
	createWasmEnrichmentProvider,
	type WasmEnrichmentProviderOptions,
} from "./wasm-enrichment-provider.js";
export {
	surfaceModel,
	isSurfaceGroup,
	type SurfaceModel,
	type SurfaceSection,
	type SurfaceItem,
} from "./surface-model.js";
export {
	renderWebUi,
	serveWebUi,
	type WebUiOptions,
	type SendPrompt,
} from "./web-ui.js";
export {
	runTui,
	renderTuiMenu,
	handleTuiLine,
	type TuiOptions,
	type TuiLineResult,
} from "./tui.js";
