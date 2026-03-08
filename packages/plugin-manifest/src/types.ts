export type TelemetryHook =
  | "onLoad"
  | "onInit"
  | "onRequest"
  | "onError"
  | "onTeardown";

export interface PluginCapabilities {
  provides: string[];
  requires: string[];
  providesApi?: string[];
  requiresApi?: string[];
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
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

export const REQUIRED_TELEMETRY_HOOKS: readonly TelemetryHook[] = [
  "onLoad",
  "onInit",
  "onRequest",
  "onError",
  "onTeardown",
] as const;
