# @refarm.dev/infra-cloudflare

Cloudflare provider primitives for Refarm — agnostic of any specific service.

Exposes `CloudflareProvider` and the `ServiceManifest` convention used by
service packages (`@refarm.dev/infra-turbo-cache`, and future services).

## What lives here

| Export | Purpose |
|---|---|
| `CloudflareProvider` | Resolves account ID, executes wrangler with token in env |
| `ServiceManifest` | Convention type for declaring a Cloudflare-backed service |

## What does NOT live here

Business-level services (Turborepo cache, KV stores, Pages deployments) live
in their own packages and import `CloudflareProvider` from here.

## Usage

```ts
import { CloudflareProvider } from "@refarm.dev/infra-cloudflare";

const provider = await CloudflareProvider.create({ apiToken });
await provider.exec(["r2", "bucket", "list"], process.cwd());
```
