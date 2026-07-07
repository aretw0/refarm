export { CapabilityRegistry, createCapabilityRegistry } from "./registry.js";
export {
	buildCapabilityRoutes,
	createCapabilityRouteHandler,
} from "./http-projector.js";
// NOTE: agent-projector.ts is deliberately NOT re-exported here. It is the pure
// web-surface seam (a future browser/introspection endpoint imports it directly),
// NOT the live agent path — the shipping agent leg (#6) lists + invokes plugin
// tools entirely in the Rust host + WASM guest. Keeping it off the barrel prevents
// anything wiring it onto the live path by accident. See agent-projector.ts header.
export { parseCapabilityArgv } from "./parse-argv.js";
export {
	resolveGroupAction,
	type ResolvedGroupAction,
} from "./group-dispatch.js";
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
