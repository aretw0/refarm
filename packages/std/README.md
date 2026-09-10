# @refarm.dev/std

Zero-dependency pure primitives a local-first host and its packages share:
slugs, hash shapes, and the bind/surface guards that decide where a listener
may open. Nothing here does I/O; every function is a pure decision a caller
can test in isolation.

## Install

```bash
pnpm add @refarm.dev/std
```

## What it provides

| Export | Purpose |
|---|---|
| `slugify(text, options?)` | A stable, filesystem- and URL-safe slug from free text (`SlugifyOptions` controls separators and length). |
| `isSha256Hex(value)`, `timingSafeHexEqual(a, b)` | Shape check and constant-time comparison for hex digests. |
| `DEFAULT_BIND_HOST`, `isLoopbackBindHost`, `bindHostsMatch`, `assertBindAllowed`, `refuseUnguardedNonLoopbackBind` | Bind guards: a listener outside loopback must be declared and gated, or it is refused — the rule, not the server. |
| `parseSurfaces`, `resolveDeclaredBindHost`, `resolveDeclaredSurfaceBind`, `refuseBindOutsideDeclaration`, `refuseGateThisListenerCannotEnforce`, `surfaceEnforceableGate`, `anySurfaceDeclaresDeviceTokenGate`, `KNOWN_SURFACES`, `SURFACE_*` | Surface declarations: which named surfaces a node exposes, on which host, behind which gate — parsed and resolved once, then handed to every listener. |

```ts
import { slugify, resolveDeclaredSurfaceBind } from "@refarm.dev/std";

slugify("Casa Ecológica Demo"); // "casa-ecologica-demo"
```

## Boundary

This package owns vocabulary and pure decisions. Listeners, servers, files
and processes belong to the host that calls it; product names, copy and
policy files belong downstream.
