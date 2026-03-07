export const IDENTITY_CAPABILITY = "identity:v1" as const;

export type IdentityErrorCode =
  | "NOT_FOUND"
  | "INVALID_KEY"
  | "AUTH_FAILED"
  | "REVOKED"
  | "INTERNAL";

export interface Identity {
  id: string;
  publicKey: string;
  displayName?: string;
  createdAt: string;
}

export interface SignatureResult {
  signature: string;
  algorithm: string;
}

export interface VerificationResult {
  valid: boolean;
  identity: Identity;
}

export interface IdentityTelemetryEvent {
  traceId: string;
  pluginId: string;
  capability: typeof IDENTITY_CAPABILITY;
  operation: "create" | "sign" | "verify" | "get";
  durationMs: number;
  ok: boolean;
  errorCode?: IdentityErrorCode;
}

export interface IdentityProvider {
  readonly pluginId: string;
  readonly capability: typeof IDENTITY_CAPABILITY;

  create(displayName?: string): Promise<Identity>;
  sign(identityId: string, data: string): Promise<SignatureResult>;
  verify(signature: string, data: string): Promise<VerificationResult>;
  get(identityId: string): Promise<Identity | null>;
}

export interface IdentityConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}
