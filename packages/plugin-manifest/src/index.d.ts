export type TelemetryHook = "onLoad" | "onInit" | "onRequest" | "onError" | "onTeardown";
export type PluginExecutionProfile = "strict" | "trusted-fast";
export type ExecutionContextType = "main-thread" | "worker" | "service-worker" | "node" | "edge";

export interface ExecutionContextConfig {
  preferred: ExecutionContextType;
  fallback?: ExecutionContextType;
  allowed: ExecutionContextType[];
}

export interface PluginTrustMetadata {
  profile: PluginExecutionProfile;
  leaseHours?: number;
}

export interface PluginCapabilities {
  provides: string[];
  requires: string[];
  providesApi?: string[];
  requiresApi?: string[];
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
  targets: ("browser" | "server" | "remote")[];
  ui?: {
    icon?: string;
    slots?: string[];
    color?: string;
  };
  certification: {
    license: string;
    a11yLevel: number;
    languages: string[];
  };
  i18n?: Record<string, any> | string;
  executionContext?: ExecutionContextConfig;
  trust?: PluginTrustMetadata;
  integrity?: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

export const REQUIRED_TELEMETRY_HOOKS: readonly TelemetryHook[];

export function createMockManifest(overrides?: Partial<PluginManifest>): PluginManifest;
export function validatePluginManifest(manifest: any): ManifestValidationResult;
export function assertValidPluginManifest(manifest: any): void;
