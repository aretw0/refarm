export {
  REQUIRED_TELEMETRY_HOOKS,
  type ManifestValidationResult,
  type PluginCapabilities,
  type PluginManifest,
  type TelemetryHook,
} from "./types.js";

export { assertValidPluginManifest, validatePluginManifest } from "./validate.js";
