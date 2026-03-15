export type TelemetryHook = "onLoad" | "onInit" | "onRequest" | "onError" | "onTeardown";
export type PluginExecutionProfile = "strict" | "trusted-fast";
export interface PluginTrustMetadata {
    /** Preferred runtime profile. `trusted-fast` requires an explicit host trust grant. */
    profile: PluginExecutionProfile;
    /** Optional TTL hint for host-side trust grants. */
    leaseHours?: number;
}
export interface PluginCapabilities {
    provides: string[];
    requires: string[];
    providesApi?: string[];
    requiresApi?: string[];
    /** Domains this plugin is allowed to fetch (e.g. ["https://api.github.com"]) */
    allowedOrigins?: string[];
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
    /**
     * Execution targets where this plugin is compatible and allowed to run.
     */
    targets: ("browser" | "server" | "remote")[];
    /**
     * UI metadata for the Refarm Host/Shell presentation.
     */
    ui?: {
        /** Icon identifier (e.g. "lucide:terminal") or a small Data URI */
        icon?: string;
        /** Preferred layout slots in the Host (e.g. ["sidebar", "statusbar"]) */
        slots?: string[];
        /** Brand color for visual highlighting in the shell */
        color?: string;
    };
    /**
     * Certification metadata for the Refarm Marketplace badges.
     */
    certification: {
        /** License of the plugin (e.g. MIT, AGPL-3.0) */
        license: string;
        /** Accessibility level (0 to 3, where 3 is full WCAG support + keyboard) */
        a11yLevel: number;
        /** ISO 639-1 languages supported */
        languages: string[];
    };
    /**
     * Internationalization metadata for plugin-specific translations.
     * Can be a localized bundle or a URL to one.
     */
    i18n?: Record<string, any> | string;
    /**
     * Optional trust metadata for host policy negotiation.
     * The host decides whether to honor `trusted-fast`.
     */
    trust?: PluginTrustMetadata;
}
export interface ManifestValidationResult {
    valid: boolean;
    errors: string[];
}
export declare const REQUIRED_TELEMETRY_HOOKS: readonly TelemetryHook[];
//# sourceMappingURL=types.d.ts.map