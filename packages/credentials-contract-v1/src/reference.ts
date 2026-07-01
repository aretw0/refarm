import type { IdentityProvider } from "@refarm.dev/identity-contract-v1";
import type { StorageProvider, StorageRecord } from "@refarm.dev/storage-contract-v1";

import { canonicalJson } from "./canonical.js";
import {
	CREDENTIALS_CAPABILITY,
	type CredentialProof,
	type CredentialStatusListCredential,
	type CredentialStatusRef,
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
const STATUS_LIST_RECORD_TYPE = "credentials:v1/status-list";
const STATUS_LIST_COUNTER_RECORD_TYPE = "credentials:v1/status-list-counter";
const DEFAULT_CONTEXT = "https://www.w3.org/2018/credentials/v1";
const VC_TYPE = "VerifiableCredential";
const VP_TYPE = "VerifiablePresentation";
const STATUS_LIST_CREDENTIAL_TYPE = "BitstringStatusListCredential";
const STATUS_LIST_ENTRY_TYPE = "BitstringStatusListEntry";
const STATUS_LIST_SUBJECT_TYPE = "BitstringStatusList";
const STATUS_PURPOSE_REVOCATION = "revocation";

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

function statusListIdForIssuer(issuerId: string): string {
  return `urn:refarm:credentials:v1:status-list:${encodeURIComponent(issuerId)}:${STATUS_PURPOSE_REVOCATION}`;
}

function statusListCounterId(statusListId: string): string {
  return `${statusListId}#counter`;
}

function statusListSubjectId(statusListId: string): string {
  return `${statusListId}#list`;
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

function parseStatusListIndex(ref: CredentialStatusRef): number | null {
  const value = ref.statusListIndex;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function getStatusListId(ref: CredentialStatusRef): string {
  return ref.statusListCredential ?? ref.id;
}

function getRevocationStatusRef(credential: VerifiableCredential): CredentialStatusRef | null {
  const refs = Array.isArray(credential.credentialStatus)
    ? credential.credentialStatus
    : credential.credentialStatus
      ? [credential.credentialStatus]
      : [];
  return refs.find((ref) => !ref.statusPurpose || ref.statusPurpose === STATUS_PURPOSE_REVOCATION)
    ?? null;
}

function normalizeBitstring(encodedList: string, minLength: number): string {
  const bits = /^[01]*$/.test(encodedList) ? encodedList : "";
  return bits.padEnd(minLength, "0");
}

function setBit(encodedList: string, index: number, value: boolean): string {
  const bits = normalizeBitstring(encodedList, index + 1).split("");
  bits[index] = value ? "1" : "0";
  return bits.join("");
}

function isBitSet(encodedList: string, index: number): boolean {
  return normalizeBitstring(encodedList, index + 1)[index] === "1";
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

    const statusListed = await this.ensureCredentialStatus(credential, issuer.id);
    const unsigned: VerifiableCredential = {
      ...statusListed,
      "@context": statusListed["@context"] ?? DEFAULT_CONTEXT,
      type: statusListed.type.includes(VC_TYPE) ? statusListed.type : [VC_TYPE, ...statusListed.type],
      issuer: issuer.id,
      issuanceDate: statusListed.issuanceDate ?? nowIso(),
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

  async revoke(
    credentialOrId: VerifiableCredential | string,
    issuerIdentityId: string,
  ): Promise<{ revoked: boolean; credentialId?: string; status?: CredentialStatusRef }> {
    const credential = typeof credentialOrId === "string"
      ? await this.getStoredCredential(credentialOrId)
      : credentialOrId;
    if (!credential) return { revoked: false };

    const issuer = await this.identity.get(issuerIdentityId);
    if (!issuer) {
      throw new Error(`issuer identity not found: ${issuerIdentityId}`);
    }
    if (issuer.id !== credential.issuer) {
      throw new Error("revocation issuer must match credential issuer");
    }

    const status = getRevocationStatusRef(credential);
    if (!status) return { revoked: false, credentialId: credential.id };

    await this.writeStatusList(status, issuer.id, true);
    return { revoked: true, credentialId: credential.id, status };
  }

  private async getStoredCredential(id: string): Promise<VerifiableCredential | null> {
    const record = await this.storage.get(id);
    if (!record || record.type !== CREDENTIAL_RECORD_TYPE) return null;
    return JSON.parse(record.payload) as VerifiableCredential;
  }

  private async ensureCredentialStatus(
    credential: VerifiableCredential,
    issuerId: string,
  ): Promise<VerifiableCredential> {
    const existing = getRevocationStatusRef(credential);
    if (existing) {
      await this.writeStatusList(existing, issuerId, false);
      return credential;
    }

    const statusListId = statusListIdForIssuer(issuerId);
    const statusListIndex = await this.allocateStatusListIndex(statusListId);
    const status: CredentialStatusRef = {
      id: statusListId,
      type: STATUS_LIST_ENTRY_TYPE,
      statusPurpose: STATUS_PURPOSE_REVOCATION,
      statusListIndex: String(statusListIndex),
    };
    await this.writeStatusList(status, issuerId, false);
    return { ...credential, credentialStatus: status };
  }

  private async allocateStatusListIndex(statusListId: string): Promise<number> {
    const id = statusListCounterId(statusListId);
    const existing = await this.storage.get(id);
    const payload = existing ? JSON.parse(existing.payload) as { nextIndex?: unknown } : {};
    const nextIndex = typeof payload.nextIndex === "number" && payload.nextIndex >= 0
      ? payload.nextIndex
      : 0;
    const now = nowIso();
    await this.storage.put({
      id,
      type: STATUS_LIST_COUNTER_RECORD_TYPE,
      payload: JSON.stringify({ nextIndex: nextIndex + 1 }),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    return nextIndex;
  }

  private async readStatusList(
    statusListId: string,
  ): Promise<CredentialStatusListCredential | null> {
    const record = await this.storage.get(statusListId);
    if (!record || record.type !== STATUS_LIST_RECORD_TYPE) return null;
    return JSON.parse(record.payload) as CredentialStatusListCredential;
  }

  private async writeStatusList(
    status: CredentialStatusRef,
    issuerId: string,
    revoked: boolean,
  ): Promise<CredentialStatusListCredential> {
    const statusListId = getStatusListId(status);
    const statusListIndex = parseStatusListIndex(status);
    if (statusListIndex === null) {
      throw new Error("credential statusListIndex must be a non-negative integer");
    }

    const existing = await this.readStatusList(statusListId);
    const existingSubject = existing?.credentialSubject;
    const encodedList = setBit(
      typeof existingSubject?.encodedList === "string" ? existingSubject.encodedList : "",
      statusListIndex,
      revoked,
    );
    const base: CredentialStatusListCredential = existing
      ? existing
      : {
        "@context": [DEFAULT_CONTEXT, "https://www.w3.org/ns/credentials/status/v1"],
        type: [VC_TYPE, STATUS_LIST_CREDENTIAL_TYPE],
        id: statusListId,
        issuer: issuerId,
        issuanceDate: nowIso(),
        credentialSubject: {
          id: statusListSubjectId(statusListId),
          type: STATUS_LIST_SUBJECT_TYPE,
          statusPurpose: status.statusPurpose ?? STATUS_PURPOSE_REVOCATION,
          encodedList: "",
        },
      };
    const unsigned: CredentialStatusListCredential = {
      ...base,
      "@context": base["@context"],
      type: base.type,
      id: base.id,
      issuer: issuerId,
      issuanceDate: base.issuanceDate,
      credentialSubject: {
        ...(existingSubject ?? {
          id: statusListSubjectId(statusListId),
          type: STATUS_LIST_SUBJECT_TYPE,
          statusPurpose: status.statusPurpose ?? STATUS_PURPOSE_REVOCATION,
        }),
        id: existingSubject?.id ?? statusListSubjectId(statusListId),
        type: STATUS_LIST_SUBJECT_TYPE,
        statusPurpose: status.statusPurpose ?? existingSubject?.statusPurpose ?? STATUS_PURPOSE_REVOCATION,
        encodedList,
      },
    };
    const signature = await this.identity.sign(issuerId, credentialPayload(unsigned));
    const signed: CredentialStatusListCredential = {
      ...unsigned,
      proof: {
        type: signature.algorithm,
        created: nowIso(),
        verificationMethod: (await this.identity.get(issuerId))?.publicKey ?? issuerId,
        signature: signature.signature,
      },
    };
    const now = nowIso();
    const record = await this.storage.get(statusListId);
    await this.storage.put({
      id: statusListId,
      type: STATUS_LIST_RECORD_TYPE,
      payload: JSON.stringify(signed),
      createdAt: record?.createdAt ?? now,
      updatedAt: now,
    });
    return signed;
  }

  private async verifyCredentialNotRevoked(
    credential: VerifiableCredential,
  ): Promise<CredentialVerificationCheck> {
    const status = getRevocationStatusRef(credential);
    if (!status) {
      return fail("credential_status_missing", "credential revocation status is required");
    }

    const statusListIndex = parseStatusListIndex(status);
    if (statusListIndex === null) {
      return fail("credential_status_index_invalid", "credential statusListIndex is invalid");
    }

    const statusListId = getStatusListId(status);
    const statusList = await this.readStatusList(statusListId);
    if (!statusList) {
      return fail("credential_status_unresolved", "credential revocation status could not be resolved");
    }
    if (statusList.issuer !== credential.issuer) {
      return fail(
        "credential_status_issuer_mismatch",
        "credential status list issuer does not match credential issuer",
      );
    }
    if (statusList.credentialSubject.statusPurpose !== STATUS_PURPOSE_REVOCATION) {
      return fail(
        "credential_status_purpose_unsupported",
        "credential status list purpose is not revocation",
      );
    }
    if (!statusList.proof) {
      return fail("credential_status_proof_missing", "credential status list proof is required");
    }

    try {
      const result = await this.identity.verify(
        statusList.proof.signature,
        credentialPayload(statusList),
      );
      if (!result.valid || result.identity.id !== statusList.issuer) {
        return fail("credential_status_signature_invalid", "credential status list signature is invalid");
      }
    } catch (error) {
      return fail(
        "credential_status_signature_verify_threw",
        `credential status list signature verification threw: ${String(error)}`,
      );
    }

    if (isBitSet(statusList.credentialSubject.encodedList, statusListIndex)) {
      return fail("credential_revoked", "credential is revoked by its status list");
    }

    return pass();
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
      checks.notRevoked = await this.verifyCredentialNotRevoked(credential);
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
