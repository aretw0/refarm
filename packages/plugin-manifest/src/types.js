/** @typedef {import('./index.d.ts').TelemetryHook} TelemetryHook */
/** @typedef {import('./index.d.ts').PluginExecutionProfile} PluginExecutionProfile */
/** @typedef {import('./index.d.ts').ExecutionContextType} ExecutionContextType */
/** @typedef {import('./index.d.ts').ExtensionSurfaceLayer} ExtensionSurfaceLayer */
/** @typedef {import('./index.d.ts').ExtensionSurfaceDeclaration} ExtensionSurfaceDeclaration */
/** @typedef {import('./index.d.ts').PluginExtensions} PluginExtensions */
/** @typedef {import('./index.d.ts').ExecutionContextConfig} ExecutionContextConfig */
/** @typedef {import('./index.d.ts').PluginTrustMetadata} PluginTrustMetadata */
/** @typedef {import('./index.d.ts').PluginCapabilities} PluginCapabilities */
/** @typedef {import('./index.d.ts').PluginManifest} PluginManifest */
/** @typedef {import('./index.d.ts').ManifestValidationResult} ManifestValidationResult */

/** @type {readonly TelemetryHook[]} */
export const REQUIRED_TELEMETRY_HOOKS = [
  "onLoad",
  "onInit",
  "onRequest",
  "onError",
  "onTeardown",
];
