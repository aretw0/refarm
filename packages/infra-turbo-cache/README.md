# @refarm.dev/infra-turbo-cache

Provider-neutral Turborepo Remote Cache service block.

This package defines the semantic service contract for Refarm-managed remote
cache, not a provider implementation. It intentionally does **not** depend on
Cloudflare, `wrangler`, Workers, R2, AWS, Vercel, or any other provider SDK.

## Boundary

- This package owns the service identity and manifest (`turbo-cache`).
- Provider packages own concrete resources and execution adapters.
- The Cloudflare adapter currently lives in `@refarm.dev/infra-cloudflare` and
  implements this block with a Cloudflare Worker + R2 bucket.

This keeps the remote-cache primitive reusable for future providers.

## Current implementation

```ts
import { turboCacheManifest } from "@refarm.dev/infra-turbo-cache";
```

Cloudflare provisioning is exposed separately:

```ts
import { CloudflareTurboCacheProvisioner } from "@refarm.dev/infra-cloudflare";
```
