export const CREDENTIALS_CAPABILITY = "credentials:v1" as const;

export interface CredentialProof {
  type: string;
  created: string;
  verificationMethod: string;
  signature: string;
}

export interface VerifiableCredential {
  "@context": string | string[];
  type: string[];
  id?: string;
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
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

export interface CredentialVerificationResult {
  valid: boolean;
  issuer?: string;
  holder?: string;
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
