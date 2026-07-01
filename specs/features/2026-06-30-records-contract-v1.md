# Spec: Records Contract v1 (`records:v1`) — Knowledge/Content Manifest

**Status:** IMPLEMENTED — package slice and downstream `vault-seed` consumer proof landed; selected for `vault-seed-ready` while public publish waits on the release lane
**Authors:** Arthur Silva, Claude
**Date:** 2026-06-30
**Related:** [`specs/features/2026-06-30-work-3-requirements-supply-activation.md`](./2026-06-30-work-3-requirements-supply-activation.md),
[`specs/features/2026-06-30-enrichment-contract-v1.md`](./2026-06-30-enrichment-contract-v1.md),
`packages/artifact-contract-v1` (provenance), `packages/source-contract-v1` (source refs),
ADR-010 (JSON-LD schema evolution / lens upcasting), ADR-077 (forward-safe envelope lesson),
`packages/surveyor` (first graph consumer)

---

## Context & Motivation

A structured knowledge record — typed, with content sections, relations to other records,
attachments, source references, a content hash, and a review state — is the core shape of the
Sovereign Graph. `surveyor` already navigates JSON-LD nodes in SQLite, the lab renders them, and any
content export needs them. There is no versioned contract that *defines* that record envelope; each
consumer re-derives it.

The supply map records a "future knowledge/content manifest **contract**", held until a second
consumer proves the envelope. The requirements-vault proof is that second consumer. This spec
activates the held contract — **thin**, composing what already exists, and shaped so the foundation
does not need obvious breaking changes as the graph grows.

This is not a vault-specific schema. OKF mapping, editorial governance, domain vocabulary, and
publication copy stay downstream. `records:v1` owns only the neutral record/relation/review envelope
and its forward-compatibility rules.

### Confirmed decisions

| Decision | Choice | Reason |
|---|---|---|
| Form | `records:v1` capability contract (types + conformance + validator) | Refarm's idiom; multiple surfaces (surveyor, lab, exporters) consume it. |
| Scope of v1 | record + relations (edges) + sections + attachments + source refs + hash + review state | The minimal shape rcdc-class vaults and the graph already need. Nothing more. |
| Composition | provenance via `artifact-contract-v1`; source refs via `source:v1` (opaque); types via JSON-LD | A thin contract that reuses, not duplicates. |
| Vocabulary | JSON-LD `@type`/`@context` — vocabulary is **data** | New types never require a contract change. |
| Evolution | `schemaVersion` per record + lens upcast (ADR-010) + preserve-unknown (ADR-077 lesson) | Forward-safe foundation; older readers do not corrupt newer records. |

### First consumer is Refarm

Per the dogfood gate, `records:v1` is supplyable only after Refarm consumes it. The first consumers
are Refarm's own surfaces: `surveyor` reads `records:v1` envelopes as graph nodes/edges, and the lab
renders them. A requirements-vault and any domain vocabulary come later.

### Downstream consumer proof (vault-seed, 2026-07)

An external consumer vault has landed the downstream proof beyond Refarm's own surveyor/lab consumption:
`vault-seed` vendors `records:v1` with a consumer-contract test, projects its PARA notes into `records:v1`
(the reference-vault composition proof), and round-trips a record through the YAML-LD codec
(`recordToYamlLdObject` ↔ note front matter).

---

## 1. Contract interface (`packages/records-contract-v1/src/types.ts`)

```ts
export const RECORDS_CAPABILITY = "records:v1" as const;

/** A graph edge. `type` is an OPEN string (extensible), not a closed union. */
export interface RecordRelation {
  type: string;                 // e.g. "refines" | "dependsOn" | "derivedFrom" | <future>
  target: string;               // target record id
  attrs?: Record<string, unknown>;
}

export interface RecordSection {
  key: string;                  // e.g. "description" | "acceptance"
  content: string;              // markdown/text
  attrs?: Record<string, unknown>;
}

export interface RecordAttachment {
  id: string;
  ref: string;                  // opaque source/artifact ref (not dereferenced here)
  mediaType?: string;
  hash?: string;
}

/** Review state is an OPEN string so new states never break older readers. */
export interface RecordReview {
  state: string;                // e.g. "draft" | "reviewed" | "accepted" | <future>
  at?: string;
  by?: string;
  notes?: string;
}

export interface KnowledgeRecord {
  id: string;
  schemaVersion: number;                       // for lens upcasting (ADR-010)
  "@type"?: string | string[];                 // JSON-LD type(s) — vocabulary is data
  "@context"?: string | Record<string, unknown>;
  fields: Record<string, unknown>;             // typed properties (JSON-LD predicates)
  sections?: RecordSection[];
  relations?: RecordRelation[];                // graph edges
  attachments?: RecordAttachment[];
  sourceRefs?: string[];                       // source:v1 refs (opaque) — origin provenance
  contentHash: string;                         // hash of canonical content (audit/dedupe)
  review?: RecordReview;
  /** FORWARD-COMPAT RULE: unknown keys MUST be preserved on read/write. */
  [extra: string]: unknown;
}

export interface RecordsManifest {
  manifestVersion: 1;
  records: KnowledgeRecord[];
  // Provenance of the manifest as a whole attaches via artifact-contract-v1, not duplicated here.
}

export interface RecordsProvider {
  readonly pluginId: string;
  readonly capability: typeof RECORDS_CAPABILITY;

  /** Validate envelope shape + referential integrity (relation targets exist). */
  validate(manifest: RecordsManifest): { ok: boolean; failures: Array<{ id?: string; message: string }> };

  /** Lens upcast: migrate a record at an older schemaVersion to the current one,
   *  preserving unknown fields. The path ADR-010 already establishes. */
  upcast(record: KnowledgeRecord): KnowledgeRecord;
}
```

## 2. Reference implementation + conformance

- `packages/records-contract-v1/src/reference.ts`: an in-memory provider that validates a small
  fixture manifest (records with relations, sections, source refs, review state) and round-trips it.
- `runRecordsV1Conformance(provider)`: asserts envelope validation; that relation targets resolve;
  that **unknown fields survive a read/write round-trip** (forward-safety); that `upcast` raises an
  older `schemaVersion` fixture to the current one without dropping data; that `contentHash` is
  stable for canonical content.

Current implementation note: `@refarm.dev/records-contract-v1` now provides the
versioned types, deterministic reference fixture/provider, referential-integrity
validation, stable content-hash helper, open-vocabulary validation, and
forward-safe upcast. It does not store, sync, render, or dereference sources or
artifacts. The downstream `vault-seed` proof now exists, so the base package is
selected for `vault-seed-ready`; final public publication still runs through the
release lane.

## 3. Forward compatibility — "the solo for the future"

The v1 foundation is shaped so the obvious future moves are **additive, not breaking**:

- **Versioned records.** Every record carries `schemaVersion`; `upcast` (ADR-010 lens) migrates old
  → current. A `records:v2` is needed only if a field must *change meaning*, never for additions.
- **Vocabulary is data.** `@type`/`@context` (JSON-LD) mean new record types and predicates ship as
  data, not as contract edits.
- **Open enums.** `relation.type` and `review.state` are open strings — new relation kinds and
  review states do not break older readers.
- **Preserve-unknown (ADR-077 lesson).** Readers MUST round-trip unknown keys, so a newer producer's
  fields survive an older consumer instead of being silently dropped.
- **Relations are graph edges.** Aligning the envelope with the Sovereign Graph (surveyor) means the
  long-term substrate *is* the model — not a POC-shaped schema we outgrow.

Reserved-but-not-built (optional, additive when a consumer proves them): typed attachment payloads,
edge weights/qualifiers, signed records, and graph-level manifests. None requires a v1 break.

## 4. Boundary

Refarm owns: the envelope types, conformance/validator, lens upcast, the reference fixture provider.

Consumer vaults own: which records exist, PARA placement, editorial workflow, renderer choice, the
domain vocabulary expressed through `@type`/`fields`.

Private downstream proofs own: domain-specific record types and vocabulary, and any private source
the records reference.

## 5. Verification

1. package-local unit tests + `runRecordsV1Conformance` over the reference provider;
2. forward-safety test: unknown fields and a higher `schemaVersion` round-trip without loss;
3. referential-integrity test: dangling relation targets are reported, not silently accepted;
4. composition proof: a manifest carries `source:v1` refs and attaches to an `artifact-contract-v1`
   provenance manifest;
5. fallback: a consumer without a `records:v1` provider degrades to treating records as opaque notes
   (no graph features), so distributed scripts do not break without the package.

## 6. Context resolution — open

Records stamp `@context: "https://refarm.dev/contexts/records/v1"` (reference provider), but that URL is
**not yet served** — no `/contexts/records/v1` route exists (the public `apps/site` has none). Today the
`@context` is validated only as a string/object and used as an **opaque namespace** (vocabulary-as-data,
never dereferenced), which works for the current consumers.

For records:v1 to be **dereferenceable linked data** (a third party fetches the context to expand terms),
Refarm must serve a real JSON-LD context document at that URL. The pattern already exists
(`schemas/sovereign-graph.jsonld`, `tractor-ts/src/schema/*.jsonld`); the new public `apps/site` is the
natural host. Until then the URL is a stable identifier, not a resolvable document.

Flagged by the vault-seed consumer (2026-07-01): the base context is used downstream as
`RECORDS_BASE_CONTEXT`, so its resolvability — or a documented decision to keep it opaque — is a shared
records:v1 completeness item.

## Non-Goals

- No OKF mapping, editorial governance, or publication copy in the contract.
- No domain vocabulary or fixed taxonomy — types/predicates are JSON-LD data.
- No storage/sync engine — `records:v1` is an envelope, not a backend (`storage:v1`/`sync:v1` persist).
- No attachment dereferencing or binary handling in v1.
