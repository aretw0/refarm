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

export interface SessionDerivedIdentityHandle {
  /**
   * Opaque provider-owned handle to a live or persisted identity materialization.
   * Consumers must not parse it or assume it is a key.
   */
  handle: string;
  identity: Identity;
  algorithm: string;
  expiresAt?: string;
}

export interface SessionDerivationInput {
  /**
   * Protocol label such as "opaque", "webauthn", or a provider-specific value.
   * The v1 contract treats the payload as protocol-owned bytes.
   */
  protocol: string;
  session: Uint8Array;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface IdentityTelemetryEvent {
  traceId: string;
  pluginId: string;
  capability: typeof IDENTITY_CAPABILITY;
  operation: "create" | "sign" | "verify" | "get" | "deriveFromSession";
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
  /**
   * Optional v1 extension point for OPAQUE, WebAuthn, or other protocols that
   * derive identity material from an authenticated session. Providers own the
   * session format and return an opaque handle, so supporting this does not
   * require a capability version bump.
   */
  deriveFromSession?(
    input: SessionDerivationInput,
  ): Promise<SessionDerivedIdentityHandle>;
}

export interface IdentityAdapter {
  publicKey?: string;
  sign?(data: string): Promise<{ signature: string; algorithm: string }>;
}

export interface IdentityConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}
