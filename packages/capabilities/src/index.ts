export { CapabilityRegistry, createCapabilityRegistry } from "./registry.js";
export { parseCapabilityArgv } from "./parse-argv.js";
export { buildCapabilityRoutes, createCapabilityRouteHandler } from "./http-projector.js";
export { createEventStreamHandler, broadcastEventSource, type EventStreamSource } from "./event-stream.js";
export {
	buildCapabilityOpenApiDocument,
	type CapabilityOpenApiDocument,
	type CapabilityOpenApiOperation,
	type CapabilityOpenApiOptions,
} from "./openapi-projector.js";
// The agent-projector (the pure capability→tool-schema web-surface seam) is now
// re-exported: the `serve` command mounts it at /agent-tools, so it has a real,
// deliberate consumer. It is NOT on the live Rust agent path (which lists/invokes
// plugin tools in the host+guest) — see the agent-projector.ts header — but the web
// surface listing agent tools for a browser IS exactly what it was built for.
export {
	capabilityAnthropicTools,
	capabilityOpenAiTools,
	capabilityToAnthropicTool,
	capabilityToOpenAiTool,
	capabilityToolParameters,
	type AnthropicToolSchema,
	type OpenAiToolSchema,
	type ToolParameterSchema,
} from "./agent-projector.js";
export {
	validateCapabilityArgs,
	validateAgainstSchema,
	type CapabilityArgError,
	type CapabilityArgValidation,
} from "./arg-validator.js";
export {
	buildCapabilityScaffold,
	toCamelCase,
	type CapabilityScaffoldSpec,
	type CapabilityScaffold,
	type ScaffoldFile,
} from "./scaffold.js";
export {
	dispatchCapability,
	resolveCapabilityInvocation,
	type CapabilityInvocation,
	type CapabilityDispatchOutcome,
} from "./dispatch.js";
export {
	surfaceModel,
	projectSurface,
	tuiSurfaceModel,
	webSurfaceModel,
	surfacesOf,
	isSurfaceGroup,
	type SurfaceModel,
	type SurfaceSection,
	type SurfaceItem,
	type SurfaceHint,
} from "./surface-model.js";
export { buildPaletteModel, type PaletteModel, type PaletteEntry } from "./palette-projector.js";
export { buildIdeModel, type IdeModel, type IdeCommand } from "./ide-projector.js";
export {
	buildVscodeManifest,
	type BuildVscodeManifestOptions,
	type VscodeContributes,
	type VscodeExtensionManifest,
} from "./vscode-manifest.js";
export { resolveGroupAction, type ResolvedGroupAction } from "./group-dispatch.js";
export {
	ActivitySink,
	ambientActivitySink,
	newActivityRef,
	withActivity,
	type ActivityKind,
	type ActivityListener,
	type ActivityPhase,
	type ActivityReporter,
	type ProcessActivity,
	type Unsubscribe,
	type WithActivityOptions,
} from "./activity.js";
export {
	isCapabilityGroup,
	type CapabilityAgentTransport,
	type CapabilityArgSpec,
	type CapabilityCliTransport,
	type CapabilityDescriptor,
	type CapabilityEntry,
	type CapabilityEnvelope,
	type CapabilityGroup,
	type CapabilityGroupResolution,
	type CapabilityGroupResolver,
	type CapabilityHttpTransport,
	type CapabilityInput,
	type CapabilityOptionKind,
	type CapabilityOptionSpec,
	type CapabilityRenderers,
	type CapabilityReplTransport,
	type CapabilityTransports,
	type CapabilityTuiRenderer,
	type CapabilityWebRenderer,
} from "./types.js";
