# @refarm.dev/infra-cloudflare

Cloudflare provider primitives for Refarm.

This package owns Cloudflare-specific concerns:

- Cloudflare account/token context (`CloudflareProvider`)
- `wrangler` binary resolution and execution
- Cloudflare resource plans (`R2`, Worker, secrets)
- Cloudflare adapters for provider-neutral service blocks, starting with
  `@refarm.dev/infra-turbo-cache`

## Boundary

`@refarm.dev/infra-cloudflare` may depend on provider-neutral service blocks.
Provider-neutral service blocks must not depend on Cloudflare or `wrangler`.

That keeps services like `turbo-cache` reusable for future providers while this
package remains the Cloudflare implementation adapter.

## Usage

```ts
import {
  CloudflareProvider,
  CloudflareTurboCacheProvisioner,
} from "@refarm.dev/infra-cloudflare";

const provider = await CloudflareProvider.create({ apiToken });
const provisioner = new CloudflareTurboCacheProvisioner(provider);
const output = await provisioner.provision({ bucketName: "refarm-turbo-cache" });
```
