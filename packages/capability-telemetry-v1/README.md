# @refarm.dev/capability-telemetry-v1

The shared generic skeleton behind every `*TelemetryEvent` type declared by a
`packages/*-contract-v1` capability contract: `EnrichmentTelemetryEvent`,
`IdentityTelemetryEvent`, `SourceTelemetryEvent`, `StorageTelemetryEvent`,
`SyncTelemetryEvent`. Those five were hand-copied, identical except for three
points — which capability constant, which operation union, which error-code
union — the exact "two sources for one answer" shape this repository's
reachability gate (`scripts/ci/check-contract-reachability.mjs`) exists to
catch. This package expresses the skeleton once.

## Usage

```ts
import type { CapabilityTelemetryEvent } from "@refarm.dev/capability-telemetry-v1";

export type EnrichmentTelemetryEvent = CapabilityTelemetryEvent<
  typeof ENRICHMENT_CAPABILITY,
  "describe" | "select" | "enrich",
  EnrichmentErrorCode
>;
```

A contract with an extra field (e.g. `source-contract-v1`'s `kind?:
SourceKind`) intersects it: `CapabilityTelemetryEvent<...> & { kind?:
SourceKind }`.

`TypesAreEqual`/`Expect` are exact type-equality assertions each contract
pairs with its instantiation, proving the generic form still matches the
type's original literal shape — see any of the five contracts' `types.ts`
for the pattern.

## Why this package, not an existing one

See the doc comment on `src/index.ts` for the full reasoning (evidence, not
preference): `event-contract-v1` is the wrong home (private/unpublished —
depending on it from a published contract reproduces the "unpublishable
dep" defect this repo already found once); none of the five owning
contracts import anything today (deliberate zero-dep leaves); this package
follows the one real precedent for a small, zero-dependency, cross-contract
primitive already shared by leaf contracts, `@refarm.dev/std`.

## Boundary

This package owns exactly one generic interface and its type-equality proof
helpers. It owns no capability constant, no provider interface, no
conformance suite, no runtime code — `dist/index.js` compiles to empty,
since everything it exports is a type.
