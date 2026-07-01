# @refarm.dev/credentials-contract-v1

Versioned `credentials:v1` capability contract for verifiable credentials,
verifiable presentations, and holder wallet storage.

The contract composes:

- `identity:v1` for issuer and holder proofs;
- `storage:v1` for wallet persistence.

It does not implement crypto, storage engines, hosted issuer trust registries,
remote status-list distribution, domain schemas, or wallet UX.

```ts
import { createInMemoryCredentialsProviderFixture } from "@refarm.dev/credentials-contract-v1";

const { provider: credentials, identity } = createInMemoryCredentialsProviderFixture();
const issuer = await identity.create("Issuer");
```

Verification accepts plain policy data as the second argument. With no policy,
verification remains signature-only; consumers opt into stricter checks.

```ts
const result = await credentials.verify(credential, {
  trustedIssuers: [issuer.id],
  trustSelf: true,
  validity: "required",
  requiredClaims: [{ path: "capability", equals: "credentials:v1" }],
  revocation: "required",
});

if (!result.valid) {
  console.log(result.checks);
}
```

The reference provider issues credentials with a local signed status-list
credential stored through `storage:v1`. `revocation: "required"` resolves that
local list, checks `credentialStatus.statusListIndex`, and fails when
`revoke(credential, issuerIdentityId)` flips the bit. Credentials without a
resolvable status list still fail closed. Remote status-list fetching is not part
of this package; hosts must add it behind their own egress and trust policy.
