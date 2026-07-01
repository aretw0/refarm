import type { IdentityProvider } from "@refarm.dev/identity-contract-v1";
import type { StorageProvider, StorageRecord } from "@refarm.dev/storage-contract-v1";

import { canonicalJson } from "./canonical.js";
import {
	CREDENTIALS_CAPABILITY,
	type CredentialProof,
	type CredentialVerificationCheck,
	type CredentialVerificationChecks,
	type CredentialVerificationPolicy,
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
  selfIdentityId?: string | (() => string | Promise<string>);
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
  const expiresAt = credential.validUntil ?? credential.expirationDate;
  return Boolean(expiresAt && Date.parse(expiresAt) < Date.now());
}

function isNotYetValid(credential: VerifiableCredential): boolean {
  return Boolean(credential.validFrom && Date.parse(credential.validFrom) > Date.now());
}

function pass(): CredentialVerificationCheck {
  return { ok: true };
}

function fail(code: string, message: string): CredentialVerificationCheck {
  return { ok: false, code, message };
}

function failuresFromChecks(checks: CredentialVerificationChecks): string[] {
  return Object.entries(checks)
    .filter((entry): entry is [string, CredentialVerificationCheck] => entry[1]?.ok === false)
    .map(([name, check]) => `${name}: ${check.message ?? check.code ?? "failed"}`);
}

function finalizeVerification(
  checks: CredentialVerificationChecks,
  extraFailures: string[] = [],
): { valid: boolean; verified: boolean; failures: string[] } {
  const failures = [...extraFailures, ...failuresFromChecks(checks)];
  const verified = failures.length === 0;
  return { valid: verified, verified, failures };
}

function getClaimValue(source: unknown, pathValue: string): unknown {
  return pathValue.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[segment];
  }, source);
}

export class ReferenceCredentialsProvider implements CredentialsProvider {
  readonly capability = CREDENTIALS_CAPABILITY;
  readonly pluginId: string;

  private readonly identity: IdentityProvider;
  private readonly storage: StorageProvider;
  private readonly selfIdentityId?: string | (() => string | Promise<string>);

  constructor(options: ReferenceCredentialsProviderOptions) {
    this.identity = options.identity;
    this.storage = options.storage;
    this.selfIdentityId = options.selfIdentityId;
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
    policy: CredentialVerificationPolicy = {},
  ): Promise<CredentialVerificationResult> {
    return isPresentation(input)
      ? this.verifyPresentation(input, policy)
      : this.verifyCredential(input, policy);
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
    policy: CredentialVerificationPolicy = {},
  ): Promise<CredentialVerificationResult> {
    const failures: string[] = [];
    const checks: CredentialVerificationChecks = {};
    ensureCredentialShape(credential, failures);
    if (!credential.proof) {
      checks.signature = fail("credential_proof_missing", "credential proof is required");
    }

    if (credential.proof) {
      try {
        const result = await this.identity.verify(credential.proof.signature, credentialPayload(credential));
        checks.signature = result.valid
          ? pass()
          : fail("credential_signature_invalid", "credential signature is invalid");
        if (result.identity.id !== credential.issuer) {
          checks.signature = fail(
            "credential_issuer_signature_mismatch",
            "credential issuer does not match signature identity",
          );
        }
      } catch (error) {
        checks.signature = fail(
          "credential_signature_verify_threw",
          `credential signature verification threw: ${String(error)}`,
        );
      }
    }

    if (policy.trustedIssuers || policy.trustSelf) {
      checks.issuerTrusted = await this.verifyIssuerTrust(credential, policy);
    }

    if (policy.validity === "required") {
      if (isNotYetValid(credential)) {
        checks.withinValidity = fail("credential_not_yet_valid", "credential is not yet valid");
      } else if (isExpired(credential)) {
        checks.withinValidity = fail("credential_expired", "credential is expired");
      } else {
        checks.withinValidity = pass();
      }
    }

    if (policy.requiredClaims?.length) {
      checks.claimsSatisfied = this.verifyRequiredClaims(credential, policy);
    }

    if (policy.revocation === "required") {
      checks.notRevoked = fail(
        "credential_status_unresolved",
        "credential revocation status is required but no status resolver is configured",
      );
    }

    const final = finalizeVerification(checks, failures);
    return {
      ...final,
      issuer: credential.issuer,
      checks,
    };
  }

  private async verifyPresentation(
    presentation: VerifiablePresentation,
    policy: CredentialVerificationPolicy = {},
  ): Promise<CredentialVerificationResult> {
    const failures: string[] = [];
    const checks: CredentialVerificationChecks = {};
    if (!Array.isArray(presentation.type) || !hasType(presentation.type, VP_TYPE)) {
      failures.push("presentation type must include VerifiablePresentation");
    }
    if (!presentation.holder) failures.push("presentation holder is required");
    if (!presentation.proof) failures.push("presentation proof is required");

    for (const credential of presentation.verifiableCredential) {
      const result = await this.verifyCredential(credential, policy);
      failures.push(...result.failures.map((failure) => `credential: ${failure}`));
    }

    if (policy.holderBinding) {
      checks.holderBound = this.verifyHolderBinding(presentation);
    }

    if (presentation.proof) {
      try {
        const result = await this.identity.verify(
          presentation.proof.signature,
          presentationPayload(presentation),
        );
        checks.signature = result.valid
          ? pass()
          : fail("presentation_signature_invalid", "presentation signature is invalid");
        if (result.identity.id !== presentation.holder) {
          checks.signature = fail(
            "presentation_holder_signature_mismatch",
            "presentation holder does not match signature identity",
          );
        }
      } catch (error) {
        checks.signature = fail(
          "presentation_signature_verify_threw",
          `presentation signature verification threw: ${String(error)}`,
        );
      }
    }

    const final = finalizeVerification(checks, failures);
    return {
      ...final,
      holder: presentation.holder,
      checks,
    };
  }

  private async verifyIssuerTrust(
    credential: VerifiableCredential,
    policy: CredentialVerificationPolicy,
  ): Promise<CredentialVerificationCheck> {
    if (policy.trustedIssuers?.includes(credential.issuer)) return pass();

    if (policy.trustSelf) {
      const selfIdentityId =
        typeof this.selfIdentityId === "function"
          ? await this.selfIdentityId()
          : this.selfIdentityId;
      if (!selfIdentityId) {
        return fail(
          "credential_self_identity_unconfigured",
          "credential trustSelf requires a configured self identity",
        );
      }
      const self = await this.identity.get(selfIdentityId);
      if (self?.id === credential.issuer) return pass();
    }

    return fail("credential_issuer_untrusted", "credential issuer is not trusted by policy");
  }

  private verifyRequiredClaims(
    credential: VerifiableCredential,
    policy: CredentialVerificationPolicy,
  ): CredentialVerificationCheck {
    for (const constraint of policy.requiredClaims ?? []) {
      const value = getClaimValue(credential.credentialSubject, constraint.path);
      if ("equals" in constraint && value !== constraint.equals) {
        return fail(
          "credential_claim_mismatch",
          `credential claim '${constraint.path}' does not match policy`,
        );
      }
      if (!("equals" in constraint) && value === undefined) {
        return fail("credential_claim_missing", `credential claim '${constraint.path}' is missing`);
      }
    }

    return pass();
  }

  private verifyHolderBinding(presentation: VerifiablePresentation): CredentialVerificationCheck {
    const unbound = presentation.verifiableCredential.find((credential) => {
      const subjectId = credential.credentialSubject?.id;
      return typeof subjectId === "string" && subjectId !== presentation.holder;
    });
    if (unbound) {
      return fail(
        "presentation_holder_unbound",
        "presentation holder does not match credential subject",
      );
    }
    return pass();
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
