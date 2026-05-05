export {
	assertEntryRuntimeCompatibility,
	detectEntryFormat,
	evaluateEntryRuntimeCompatibility,
	RUNTIME_ENTRY_SUPPORT,
	SUPPORTED_ENTRY_FORMATS,
} from "./entry-support.js";
export { createMockManifest } from "./fixtures.js";
export {
	EXTENSION_SURFACE_LAYERS,
	extensionSurfaceKey,
	getExtensionSurfaces,
	isExtensionSurfaceLayer,
} from "./extension-surfaces.js";
export {
	detectWasmBinaryKind,
	installWasmArtifact,
	WASM_BINARY_KINDS,
} from "./install-contract.js";
export {
	computeSha256Digest,
	isSha256DigestMatch,
	parseSha256Integrity,
	SHA256_BASE64_VALUE_RE,
	SHA256_HEX_VALUE_RE,
	verifyBufferIntegrity,
} from "./integrity.js";
export { REQUIRED_TELEMETRY_HOOKS } from "./types.js";
export {
	assertValidPluginManifest,
	validatePluginManifest,
} from "./validate.js";
