export {
    type PluginExecutionProfile,
    type PluginTrustMetadata,
    REQUIRED_TELEMETRY_HOOKS,
    type ManifestValidationResult,
    type PluginCapabilities,
    type PluginManifest,
    type TelemetryHook
} from "./types.js";

export { createMockManifest } from "./fixtures.js";
export { assertValidPluginManifest, validatePluginManifest } from "./validate.js";

