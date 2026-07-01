export const CREDENTIALS_CAPABILITY = "credentials:v1" as const;

export interface CredentialProof {
  type: string;
  created: string;
  verificationMethod: string;
  signature: string;
}

export interface CredentialStatusRef {
  id: string;
  type?: string;
  statusListIndex?: string | number;
  statusPurpose?: string;
  [extra: string]: unknown;
}

export interface VerifiableCredential {
  "@context": string | string[];
  type: string[];
  id?: string;
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
  validFrom?: string;
  validUntil?: string;
  credentialStatus?: CredentialStatusRef | CredentialStatusRef[];
  credentialSubject: Record<string, unknown> & { id?: string };
  proof?: CredentialProof;
  [extra: string]: unknown;
}

export interface VerifiablePresentation {
  "@context": string | string[];
  type: string[];
  holder: string;
  verifiableCredential: VerifiableCredential[];
  proof?: CredentialProof;
  [extra: string]: unknown;
}

export type CredentialVerificationCheckName =
  | "signature"
  | "issuerTrusted"
  | "notRevoked"
  | "withinValidity"
  | "claimsSatisfied"
  | "holderBound";

export interface CredentialVerificationCheck {
  ok: boolean;
  code?: string;
  message?: string;
}

export type CredentialVerificationChecks = Partial<
  Record<CredentialVerificationCheckName, CredentialVerificationCheck>
>;

export interface TrustRegistryRef {
  id: string;
  uri?: string;
  [extra: string]: unknown;
}

export interface ClaimConstraint {
  path: string;
  equals?: unknown;
}

export interface CredentialVerificationPolicy {
  trustedIssuers?: string[];
  trustSelf?: boolean;
  trustRegistry?: TrustRegistryRef;
  revocation?: "ignore" | "required";
  validity?: "ignore" | "required";
  requiredClaims?: ClaimConstraint[];
  holderBinding?: boolean;
}

export interface CredentialVerificationResult {
  valid: boolean;
  verified: boolean;
  issuer?: string;
  holder?: string;
  checks: CredentialVerificationChecks;
  failures: string[];
}

export interface CredentialsListFilter {
  type?: string;
  issuer?: string;
}

export interface CredentialsProvider {
  readonly pluginId: string;
  readonly capability: typeof CREDENTIALS_CAPABILITY;

  issue(
    credential: VerifiableCredential,
    issuerIdentityId: string,
  ): Promise<VerifiableCredential>;
  verify(
    input: VerifiableCredential | VerifiablePresentation,
    policy?: CredentialVerificationPolicy,
  ): Promise<CredentialVerificationResult>;
  present(
    credentials: VerifiableCredential[],
    holderIdentityId: string,
  ): Promise<VerifiablePresentation>;
  store(credential: VerifiableCredential): Promise<{ id: string }>;
  list(filter?: CredentialsListFilter): Promise<VerifiableCredential[]>;
  remove(id: string): Promise<{ removed: boolean }>;
}

export interface CredentialsConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}
