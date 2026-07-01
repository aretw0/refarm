import { describe, expect, it } from "vitest";

import {
	createInMemoryCredentialsProviderFixture,
	runCredentialsV1Conformance,
} from "./index.js";

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
});
