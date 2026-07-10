export {
	createSourceCapabilityGroup,
	defaultSourceDeps,
	type SourceCommandDeps,
} from "./source-capability.js";
export {
	isCapabilityGroup,
	resolveGroupAction,
	type ResolvedGroupAction,
} from "@refarm.dev/capabilities";
export {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
export type {
	CapabilityDescriptor,
	CapabilityEntry,
	CapabilityEnvelope,
	CapabilityGroup,
	CapabilityInput,
} from "@refarm.dev/capabilities";
export {
	createRecordsCapabilityGroup,
	defineRecordsViewCapability,
	defaultRecordsDeps,
	type RecordsAnalyzeDimension,
	type RecordsAnalyzeEnvelope,
	type RecordsAnalyzeGroup,
	type RecordsCommandDeps,
	type RecordsViewCapabilityOptions,
} from "./records-capability.js";
export {
	createBaseStatusCapability,
	type BaseStatusCapabilityOptions,
} from "./operator-state-capability.js";
export {
	createLocalVaultCommandDeps,
	createVaultCapabilityGroup,
	defaultVaultDeps,
	type LocalVaultCommandDepsOptions,
	type VaultCommandDeps,
} from "./vault-capability.js";
export type { VaultDiscoveryResult, VaultProviderSummary } from "./vault-discovery-types.js";
export { builtinCapabilities, type CapabilityDeps } from "./builtin-capabilities.js";
export { createLocalCapabilityDeps, type LocalCapabilityDepsOptions } from "./local-deps.js";
export {
	apiProvideKey,
	buildDispatchEffort,
	createPluginDescriptorDeps,
	definePluginInspectorCapability,
	isConnectionError,
	parseDispatchArgs,
	pluginDescriptorsFrom,
	pluginSurfaceName,
	registerPluginCapabilities,
	resolveApiLinks,
	surfaceablePluginVerbsFrom,
	type DispatchRequest,
	type PluginCapabilityRegistration,
	type PluginDescriptorDeps,
	type PluginDescriptorDepsOptions,
	type PluginInspectorCapabilityOptions,
	type ResolvedApiLink,
	type SurfaceablePluginVerb,
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
	buildCapabilityHostServeInfo,
	defineCapabilityHost,
	type CapabilityHost,
	type CapabilityHostCapabilities,
	type CapabilityHostCapabilitiesFactory,
	type CapabilityHostCapabilityUnitFactory,
	type CapabilityHostCapabilityUnitOptions,
	type CapabilityHostCommandBuilder,
	type CapabilityHostDefinition,
	type CapabilityHostOperatorStatus,
	type CapabilityHostPrimaryVerbOptions,
	type CapabilityHostRecordReviewCorrectionOptions,
	type CapabilityHostRecordReviewQueueUnitOptions,
	type CapabilityHostReviewQueueUnitOptions,
	type CapabilityHostSurfaceAction,
	type CapabilityHostSurfaceActionRow,
	type CapabilityHostSurfaceActionsOptions,
	type CapabilityHostSurfaceContext,
	type CapabilityHostServeCallOptions,
	type CapabilityHostServeInfo,
	type CapabilityHostServeOptions,
	type CapabilityHostStatusContext,
} from "./host.js";
export {
	isCapabilityHostCliEntrypoint,
	runCapabilityHostCli,
	type CapabilityHostCliEntrypointOptions,
	type ParseableCapabilityHostProgram,
	type RunCapabilityHostCliOptions,
} from "./host-cli.js";
export {
	createWasmSourceProvider,
	type CallRespond,
	type WasmSourceProviderOptions,
} from "./wasm-source-provider.js";
export {
	createWasmEnrichmentProvider,
	type WasmEnrichmentProviderOptions,
} from "./wasm-enrichment-provider.js";
// surfaceModel + the surface projectors moved to @refarm.dev/capabilities (the
// projector home, ADR-085) so the CLI app and this lib project from ONE function;
// re-exported here for compat + so downstream (capability-host, examples) reach them.
export {
	surfaceModel,
	projectSurface,
	tuiSurfaceModel,
	webSurfaceModel,
	buildPaletteModel,
	isSurfaceGroup,
	type SurfaceModel,
	type SurfaceSection,
	type SurfaceItem,
	type SurfaceHint,
	type PaletteModel,
	type PaletteEntry,
} from "@refarm.dev/capabilities";
// The web projection lives in the Astro + homestead surface (apps/me), not a hand-rolled
// HTML-string renderer here. surfaceModel stays as the neutral, multi-surface model the
// CLI/TUI/status project from; the web consumes it through homestead.
export {
	runTui,
	renderTuiMenu,
	handleTuiLine,
	type SendPrompt,
	type TuiOptions,
	type TuiLineResult,
} from "./tui.js";
