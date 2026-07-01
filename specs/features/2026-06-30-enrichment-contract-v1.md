# Spec: Enrichment Contract v1 (`enrichment:v1`)

**Status:** IMPLEMENTED — package slice and downstream `vault-seed` consumer proof landed; selected for `vault-seed-ready` while public publish waits on the release lane
**Authors:** Arthur Silva, Claude
**Date:** 2026-06-30
**Related:** [`specs/features/2026-06-30-work-3-requirements-supply-activation.md`](./2026-06-30-work-3-requirements-supply-activation.md),
[`packages/README-CAPABILITIES.md`](../../packages/README-CAPABILITIES.md),
`packages/storage-contract-v1` (pattern reference), `packages/artifact-contract-v1` (provenance),
`@refarm.dev/health/environment-pressure` (diagnostics)

---

## Context & Motivation

Downstream vaults re-implement the same shape: take a set of records or note files, look something up
by an external key, and write the result back with an audit trail. The lookup target differs per
consumer; the *mechanism* — select inputs, resolve by key, produce dry-run vs applied changes, record
provenance, report diagnostics — does not. Refarm should own that neutral mechanism as a versioned
capability contract, the same way `source:v1` owns "give me a stable local copy" without owning any
specific remote.

This is the smallest new contract in the Work 3 supply activation and has **no browser/runtime
dependency**, so it goes first. The contract owns rule/provider identity, input selection,
dry-run/apply results, diagnostics, and provenance. It does **not** own any external registry,
private lookup, or local vocabulary — those stay in the consumer's provider implementation.

### Confirmed decisions

| Decision | Choice | Reason |
|---|---|---|
| Form | `enrichment:v1` capability contract (types + conformance + reference impl) | Third parties implement; consumers import. Refarm's idiom. |
| Unit of work | a record or note-file with a stable id and a readable field bag | Works for structured records and front-matter notes alike. |
| Resolution | provider extracts a **key** from the input, returns **field changes** | Key/lookup is the provider's; the contract only moves selection → changes → provenance. |
| Determinism | provider must be deterministic given its inputs; external calls must be cached/replayable | Sanitized fixtures must reproduce results offline (mirrors the source adapter's replay hooks). |
| Modes | `dry-run` (default) and `apply` | A reviewer sees proposed changes before they touch notes. |
| Provenance | every change carries `{providerId, ruleId?, key, sourceRef?, hash, at}` | Auditable; attaches to `artifact-contract-v1`. |
| Impl split | reference impl in-package; real providers are separate packages/consumers | Mirrors `storage-contract-v1` + `storage-sqlite`. |

### First consumer is Refarm

Per the dogfooding gate, the contract is supplyable only after Refarm consumes it. The first consumer
is a **reference enrichment provider over deterministic local data** (e.g., adds neutral tags/fields
from a bundled fixture map), exercised in conformance. A consumer vault and any private key-lookup
provider come later.

### Downstream consumer proof (vault-seed, 2026-07)

An external consumer vault has landed the downstream proof beyond Refarm's own dogfooding: `vault-seed`
vendors `enrichment:v1` with a consumer-contract test pinning the surface, and its reference vault
composes `source-web → records:v1 → enrichment:v1` end-to-end with an empty gap ledger
(`validations/records-reference/`).

---

## 1. Contract interface (`packages/enrichment-contract-v1/src/types.ts`)

```ts
export const ENRICHMENT_CAPABILITY = "enrichment:v1" as const;

export type EnrichmentErrorCode =
  | "NO_KEY"          // input lacked the key this provider needs
  | "NO_MATCH"        // key resolved to nothing
  | "UNAVAILABLE"     // transient lookup failure
  | "INVALID_INPUT"   // record shape unusable
  | "INTERNAL";

/** A unit to enrich: a record or a parsed note. Mechanism-agnostic. */
export interface EnrichmentInput {
  id: string;                         // stable id (record id / note path)
  fields: Record<string, unknown>;    // readable field bag (front-matter / record)
  sourceRef?: string;                 // where this input came from (source:v1 ref, file)
}

/** A single proposed/applied field change, with audit. */
export interface EnrichmentChange {
  field: string;
  before: unknown;
  after: unknown;
  provenance: {
    providerId: string;
    ruleId?: string;
    key: string;                      // the value the provider resolved on
    sourceRef?: string;               // the lookup source (provider-owned)
    hash: string;                     // hash of the resolved payload (replay/audit)
    at: string;                       // ISO timestamp
  };
}

export interface EnrichmentRecordResult {
  id: string;
  changes: EnrichmentChange[];
  skipped?: { code: EnrichmentErrorCode; message?: string };
}

export interface EnrichmentResult {
  mode: "dry-run" | "apply";
  records: EnrichmentRecordResult[];
  diagnostics: {
    total: number;
    enriched: number;
    skipped: number;
    byCode: Partial<Record<EnrichmentErrorCode, number>>;
  };
}

export interface EnrichmentProvider {
  readonly pluginId: string;
  readonly capability: typeof ENRICHMENT_CAPABILITY;

  /** Static description: which fields it can add and which key it needs. */
  describe(): { providerId: string; needsKeyFrom: string[]; addsFields: string[] };

  /** Which inputs this provider can act on (has the key it needs). */
  select(inputs: EnrichmentInput[]): EnrichmentInput[];

  /** Resolve + produce changes. `dry-run` computes without mutating; `apply` is the same
   *  computation the caller persists. The provider never writes notes itself. */
  enrich(
    inputs: EnrichmentInput[],
    options?: { mode?: "dry-run" | "apply"; signal?: AbortSignal },
  ): Promise<EnrichmentResult>;
}
```

Key boundary in the types: the provider **returns** changes; it never persists. Writing back to notes
is the consumer vault's ETL/renderer concern. This keeps `enrichment:v1` free of PARA/Obsidian/vault
shape.

## 2. Reference implementation + conformance

- `packages/enrichment-contract-v1/src/reference.ts`: a deterministic provider that resolves a key
  field against a **bundled fixture map** and adds neutral tags/fields. Zero network, zero private
  data.
- `runEnrichmentV1Conformance(provider)`: asserts `describe`/`select`/`enrich` shapes; that `dry-run`
  and `apply` produce identical `changes` for identical input; that every change carries complete
  provenance; that missing-key and no-match inputs land in `skipped` with the right code; that
  `diagnostics` counts reconcile.
- Telemetry: emit the standard `TelemetryEvent` per `enrich` call (capability, durationMs, ok).

Current implementation note: `@refarm.dev/enrichment-contract-v1` now provides
the versioned types, deterministic fixture provider, and conformance suite. It
does not persist changes or perform network access. The downstream `vault-seed`
proof now exists, so it is selected for `vault-seed-ready`; final public
publication still runs through the release lane.

## 3. Boundary

Refarm owns: the contract, conformance, the reference fixture provider, provenance shape, diagnostics
counters.

Consumer vaults own: persisting changes into notes (ETL/renderer), the review UX, field/vocabulary
choices.

Private downstream proofs own: the real key-lookup provider (registry/endpoint), any credentials it
needs (via `silo`), and the domain vocabulary it enriches into. They implement `EnrichmentProvider`
and pass conformance; nothing about the target leaks into Refarm.

## 4. Verification

1. package-local unit tests + `runEnrichmentV1Conformance` over the reference provider;
2. determinism test: `dry-run` == `apply` changes for the same fixture;
3. provenance completeness test (no change without full provenance);
4. a sanitized downstream proof: a non-reference provider over a local fixture passes conformance and
   feeds an `artifact-contract-v1` manifest;
5. explicit fallback: a consumer with no enrichment provider available degrades to a no-op (records
   pass through unchanged, diagnostics report `skipped`/`NO provider`), so distributed scripts do not
   break without the package.

## Non-Goals

- No external registry, HTTP client, or credential handling in the contract package.
- No note/PARA writing — changes are returned, not persisted.
- No domain vocabulary or field taxonomy baked into `enrichment:v1`.
- No coupling to `source:v1`; an `EnrichmentInput.sourceRef` is an opaque string, not a dependency.
