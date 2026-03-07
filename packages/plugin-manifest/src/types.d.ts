export type TelemetryHook = "onLoad" | "onInit" | "onRequest" | "onError" | "onTeardown";
export interface PluginCapabilities {
    provides: string[];
    requires: string[];
}
export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    entry: string;
    capabilities: PluginCapabilities;
    permissions: string[];
    observability: {
        hooks: TelemetryHook[];
    };
}
export interface ManifestValidationResult {
    valid: boolean;
    errors: string[];
}
export declare const REQUIRED_TELEMETRY_HOOKS: readonly TelemetryHook[];
//# sourceMappingURL=types.d.ts.map