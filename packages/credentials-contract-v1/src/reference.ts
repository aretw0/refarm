import type { IdentityProvider } from "@refarm.dev/identity-contract-v1";
import type { StorageProvider, StorageRecord } from "@refarm.dev/storage-contract-v1";

import { canonicalJson } from "./canonical.js";
import {
	CREDENTIALS_CAPABILITY,
	type CredentialProof,
	type CredentialVerificationResult,
	type CredentialsListFilter,
	type CredentialsProvider,
	type VerifiableCredential,
	type VerifiablePresentation,
} from "./types.js";

const CREDENTIAL_RECORD_TYPE = "credentials:v1/credential";
const DEFAULT_CONTEXT = "https://www.w3.org/2018/credentials/v1";
const VC_TYPE = "VerifiableCredential";
const VP_TYPE = "VerifiablePresentation";

export interface ReferenceCredentialsProviderOptions {
  identity: IdentityProvider;
  storage: StorageProvider;
  pluginId?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableId(prefix: string, value: unknown): string {
  let hash = 0;
  const input = canonicalJson(value);
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return `${prefix}-${hash.toString(16).padStart(8, "0")}`;
}

function withoutProof<T extends { proof?: CredentialProof }>(input: T): Omit<T, "proof"> {
  const { proof: _proof, ...rest } = input;
  return rest;
}

function credentialPayload(credential: VerifiableCredential): string {
  return canonicalJson(withoutProof(credential));
}

function presentationPayload(presentation: VerifiablePresentation): string {
  return canonicalJson(withoutProof(presentation));
}

function hasType(types: string[], expected: string): boolean {
  return types.includes(expected);
}

function ensureCredentialShape(credential: VerifiableCredential, failures: string[]): void {
  if (!credential["@context"]) failures.push("credential @context is required");
  if (!Array.isArray(credential.type) || !hasType(credential.type, VC_TYPE)) {
    failures.push("credential type must include VerifiableCredential");
  }
  if (!credential.issuer) failures.push("credential issuer is required");
  if (!credential.issuanceDate) failures.push("credential issuanceDate is required");
  if (!credential.credentialSubject || typeof credential.credentialSubject !== "object") {
    failures.push("credential credentialSubject is required");
  }
}

function isExpired(credential: VerifiableCredential): boolean {
  return Boolean(credential.expirationDate && Date.parse(credential.expirationDate) < Date.now());
}

export class ReferenceCredentialsProvider implements CredentialsProvider {
  readonly capability = CREDENTIALS_CAPABILITY;
  readonly pluginId: string;

  private readonly identity: IdentityProvider;
  private readonly storage: StorageProvider;

  constructor(options: ReferenceCredentialsProviderOptions) {
    this.identity = options.identity;
    this.storage = options.storage;
    this.pluginId = options.pluginId ?? "@refarm.dev/credentials-reference";
  }

  async issue(
    credential: VerifiableCredential,
    issuerIdentityId: string,
  ): Promise<VerifiableCredential> {
    const issuer = await this.identity.get(issuerIdentityId);
    if (!issuer) {
      throw new Error(`issuer identity not found: ${issuerIdentityId}`);
    }

    const unsigned: VerifiableCredential = {
      ...credential,
      "@context": credential["@context"] ?? DEFAULT_CONTEXT,
      type: credential.type.includes(VC_TYPE) ? credential.type : [VC_TYPE, ...credential.type],
      issuer: issuer.id,
      issuanceDate: credential.issuanceDate ?? nowIso(),
    };

    const signature = await this.identity.sign(issuer.id, credentialPayload(unsigned));
    return {
      ...unsigned,
      proof: {
        type: signature.algorithm,
        created: nowIso(),
        verificationMethod: issuer.publicKey,
        signature: signature.signature,
      },
    };
  }

  async verify(
    input: VerifiableCredential | VerifiablePresentation,
  ): Promise<CredentialVerificationResult> {
    return isPresentation(input) ? this.verifyPresentation(input) : this.verifyCredential(input);
  }

  async present(
    credentials: VerifiableCredential[],
    holderIdentityId: string,
  ): Promise<VerifiablePresentation> {
    const holder = await this.identity.get(holderIdentityId);
    if (!holder) {
      throw new Error(`holder identity not found: ${holderIdentityId}`);
    }

    const presentation: VerifiablePresentation = {
      "@context": DEFAULT_CONTEXT,
      type: [VP_TYPE],
      holder: holder.id,
      verifiableCredential: credentials,
    };
    const signature = await this.identity.sign(holder.id, presentationPayload(presentation));

    return {
      ...presentation,
      proof: {
        type: signature.algorithm,
        created: nowIso(),
        verificationMethod: holder.publicKey,
        signature: signature.signature,
      },
    };
  }

  async store(credential: VerifiableCredential): Promise<{ id: string }> {
    const id = credential.id ?? stableId("credential", credential);
    const now = nowIso();
    const stored: VerifiableCredential = { ...credential, id };
    const existing = await this.storage.get(id);
    const record: StorageRecord = {
      id,
      type: CREDENTIAL_RECORD_TYPE,
      payload: JSON.stringify(stored),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.storage.put(record);
    return { id };
  }

  async list(filter: CredentialsListFilter = {}): Promise<VerifiableCredential[]> {
    const rows = await this.storage.query({ type: CREDENTIAL_RECORD_TYPE, limit: 1000, offset: 0 });
    return rows
      .map((row) => JSON.parse(row.payload) as VerifiableCredential)
      .filter((credential) => {
        if (filter.issuer && credential.issuer !== filter.issuer) return false;
        if (filter.type && !credential.type.includes(filter.type)) return false;
        return true;
      });
  }

  async remove(id: string): Promise<{ removed: boolean }> {
    const existing = await this.storage.get(id);
    if (!existing) return { removed: false };
    await this.storage.delete(id);
    return { removed: true };
  }

  private async verifyCredential(
    credential: VerifiableCredential,
  ): Promise<CredentialVerificationResult> {
    const failures: string[] = [];
    ensureCredentialShape(credential, failures);
    if (!credential.proof) failures.push("credential proof is required");
    if (isExpired(credential)) failures.push("credential is expired");

    if (credential.proof) {
      try {
        const result = await this.identity.verify(credential.proof.signature, credentialPayload(credential));
        if (!result.valid) failures.push("credential signature is invalid");
        if (result.identity.id !== credential.issuer) {
          failures.push("credential issuer does not match signature identity");
        }
      } catch (error) {
        failures.push(`credential signature verification threw: ${String(error)}`);
      }
    }

    return {
      valid: failures.length === 0,
      issuer: credential.issuer,
      failures,
    };
  }

  private async verifyPresentation(
    presentation: VerifiablePresentation,
  ): Promise<CredentialVerificationResult> {
    const failures: string[] = [];
    if (!Array.isArray(presentation.type) || !hasType(presentation.type, VP_TYPE)) {
      failures.push("presentation type must include VerifiablePresentation");
    }
    if (!presentation.holder) failures.push("presentation holder is required");
    if (!presentation.proof) failures.push("presentation proof is required");

    for (const credential of presentation.verifiableCredential) {
      const result = await this.verifyCredential(credential);
      failures.push(...result.failures.map((failure) => `credential: ${failure}`));
    }

    if (presentation.proof) {
      try {
        const result = await this.identity.verify(
          presentation.proof.signature,
          presentationPayload(presentation),
        );
        if (!result.valid) failures.push("presentation signature is invalid");
        if (result.identity.id !== presentation.holder) {
          failures.push("presentation holder does not match signature identity");
        }
      } catch (error) {
        failures.push(`presentation signature verification threw: ${String(error)}`);
      }
    }

    return {
      valid: failures.length === 0,
      holder: presentation.holder,
      failures,
    };
  }
}

function isPresentation(
  input: VerifiableCredential | VerifiablePresentation,
): input is VerifiablePresentation {
  return "verifiableCredential" in input;
}

export function createReferenceCredentialsProvider(
  options: ReferenceCredentialsProviderOptions,
): CredentialsProvider {
  return new ReferenceCredentialsProvider(options);
}
