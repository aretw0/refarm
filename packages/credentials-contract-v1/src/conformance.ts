import {
	CREDENTIALS_CAPABILITY,
	type CredentialsConformanceResult,
	type CredentialsProvider,
	type VerifiableCredential,
} from "./types.js";

function baseCredential(overrides: Partial<VerifiableCredential> = {}): VerifiableCredential {
  return {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://refarm.dev/contexts/credentials/v1",
    ],
    type: ["VerifiableCredential", "RefarmConformanceCredential"],
    issuer: "pending",
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      id: "did:refarm:subject:conformance",
      capability: "credentials:v1",
    },
    evidence: {
      preserved: true,
    },
    ...overrides,
  };
}

export async function runCredentialsV1Conformance(
  provider: CredentialsProvider,
  identities: { issuerIdentityId: string; holderIdentityId: string },
): Promise<CredentialsConformanceResult> {
  const failures: string[] = [];

  if (provider.capability !== CREDENTIALS_CAPABILITY) {
    failures.push("provider.capability must be 'credentials:v1'");
  }
  if (!provider.pluginId || provider.pluginId.trim().length === 0) {
    failures.push("provider.pluginId must be a non-empty string");
  }

  let issued: VerifiableCredential | null = null;

  try {
    issued = await provider.issue(baseCredential(), identities.issuerIdentityId);
    if (!issued.proof?.signature) failures.push("issue() must attach proof.signature");
    const verified = await provider.verify(issued);
    if (!verified.valid) failures.push(`verify(issue()) failed: ${verified.failures.join("; ")}`);
    if (verified.checks.signature?.ok !== true) {
      failures.push("verify(issue()) must report checks.signature.ok=true");
    }
  } catch (error) {
    failures.push(`issue()/verify() threw: ${String(error)}`);
  }

  if (issued) {
    try {
      const tampered: VerifiableCredential = {
        ...issued,
        credentialSubject: {
          ...issued.credentialSubject,
          capability: "tampered",
        },
      };
      const result = await provider.verify(tampered);
      if (result.valid) failures.push("verify() must reject tampered credentials");
    } catch (error) {
      failures.push(`tamper verify threw: ${String(error)}`);
    }

    try {
      const expired = await provider.issue(
        baseCredential({ expirationDate: "2000-01-01T00:00:00.000Z" }),
        identities.issuerIdentityId,
      );
      const signatureOnly = await provider.verify(expired);
      if (!signatureOnly.valid) {
        failures.push("verify() without policy must remain signature-only for expired credentials");
      }
      const result = await provider.verify(expired, { validity: "required" });
      if (result.valid) failures.push("verify() must reject expired credentials when validity is required");
      if (result.checks.withinValidity?.ok !== false) {
        failures.push("verify() must report checks.withinValidity.ok=false for expired credentials");
      }
    } catch (error) {
      failures.push(`expired verify threw: ${String(error)}`);
    }

    try {
      const trusted = await provider.verify(issued, { trustedIssuers: [issued.issuer] });
      if (!trusted.valid || trusted.checks.issuerTrusted?.ok !== true) {
        failures.push("trustedIssuers policy must accept the issued credential");
      }
      const untrusted = await provider.verify(issued, { trustedIssuers: ["did:example:other"] });
      if (untrusted.valid || untrusted.checks.issuerTrusted?.ok !== false) {
        failures.push("trustedIssuers policy must reject unknown issuers");
      }
    } catch (error) {
      failures.push(`trusted issuer verify threw: ${String(error)}`);
    }

    try {
      const result = await provider.verify(issued, {
        requiredClaims: [{ path: "capability", equals: "credentials:v1" }],
      });
      if (!result.valid || result.checks.claimsSatisfied?.ok !== true) {
        failures.push("requiredClaims policy must accept matching claims");
      }
      const mismatch = await provider.verify(issued, {
        requiredClaims: [{ path: "capability", equals: "other" }],
      });
      if (mismatch.valid || mismatch.checks.claimsSatisfied?.ok !== false) {
        failures.push("requiredClaims policy must reject mismatched claims");
      }
    } catch (error) {
      failures.push(`requiredClaims verify threw: ${String(error)}`);
    }

    try {
      const result = await provider.verify(issued, { revocation: "required" });
      if (result.valid || result.checks.notRevoked?.ok !== false) {
        failures.push("revocation required policy must fail closed until a status resolver exists");
      }
    } catch (error) {
      failures.push(`revocation verify threw: ${String(error)}`);
    }

    try {
      const presentation = await provider.present([issued], identities.holderIdentityId);
      const result = await provider.verify(presentation);
      if (!result.valid) {
        failures.push(`verify(presentation) failed: ${result.failures.join("; ")}`);
      }
    } catch (error) {
      failures.push(`present()/verify() threw: ${String(error)}`);
    }

    try {
      const stored = await provider.store(issued);
      const listed = await provider.list({ issuer: issued.issuer });
      const roundTrip = listed.find((credential) => credential.id === stored.id);
      if (!roundTrip) {
        failures.push("list() must include stored credential");
      } else if ((roundTrip.evidence as { preserved?: boolean } | undefined)?.preserved !== true) {
        failures.push("wallet round-trip must preserve unknown fields");
      }
      const removed = await provider.remove(stored.id);
      if (!removed.removed) failures.push("remove() must report removed=true for stored credential");
      const afterRemove = await provider.list({ issuer: issued.issuer });
      if (afterRemove.some((credential) => credential.id === stored.id)) {
        failures.push("remove() must remove stored credential from list()");
      }
    } catch (error) {
      failures.push(`wallet round-trip threw: ${String(error)}`);
    }
  }

  const failed = failures.length;
  return {
    pass: failed === 0,
    total: 13,
    failed,
    failures,
  };
}
