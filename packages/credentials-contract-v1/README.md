# @refarm.dev/credentials-contract-v1

Versioned `credentials:v1` capability contract for verifiable credentials,
verifiable presentations, and holder wallet storage.

The contract composes:

- `identity:v1` for issuer and holder proofs;
- `storage:v1` for wallet persistence.

It does not implement crypto, storage engines, issuer trust registries, domain
schemas, or wallet UX.

```ts
import { createInMemoryCredentialsProviderFixture } from "@refarm.dev/credentials-contract-v1";

const { provider: credentials, identity } = createInMemoryCredentialsProviderFixture();
const issuer = await identity.create("Issuer");
```
