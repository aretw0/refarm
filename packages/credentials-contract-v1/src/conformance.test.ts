import { describe, expect, it } from "vitest";

import {
	createInMemoryCredentialsProviderFixture,
	runCredentialsV1Conformance,
	type VerifiableCredential,
} from "./index.js";

function credential(subjectId: string): VerifiableCredential {
  return {
    "@context": "https://www.w3.org/2018/credentials/v1",
    type: ["VerifiableCredential", "TrustSelfCredential"],
    issuer: "pending",
    issuanceDate: new Date().toISOString(),
    credentialSubject: {
      id: subjectId,
      capability: "credentials:v1",
    },
  };
}

describe("credentials:v1 conformance", () => {
  it("passes for the reference provider", async () => {
    const { provider, identity } = createInMemoryCredentialsProviderFixture();
    const issuer = await identity.create("Issuer");
    const holder = await identity.create("Holder");

    const result = await runCredentialsV1Conformance(provider, {
      issuerIdentityId: issuer.id,
      holderIdentityId: holder.id,
    });

    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("evaluates trustSelf against the configured self identity", async () => {
    let selfIdentityId = "";
    const { provider, identity } = createInMemoryCredentialsProviderFixture({
      selfIdentityId: () => selfIdentityId,
    });
    const self = await identity.create("Self issuer");
    const other = await identity.create("Other issuer");
    selfIdentityId = self.id;

    const selfIssued = await provider.issue(credential(self.id), self.id);
    const otherIssued = await provider.issue(credential(self.id), other.id);

    await expect(provider.verify(selfIssued, { trustSelf: true })).resolves.toMatchObject({
      valid: true,
      checks: {
        issuerTrusted: { ok: true },
      },
    });
    await expect(provider.verify(otherIssued, { trustSelf: true })).resolves.toMatchObject({
      valid: false,
      checks: {
        issuerTrusted: { ok: false, code: "credential_issuer_untrusted" },
      },
    });
  });
});
