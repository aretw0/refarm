# @refarm.dev/vault-contract-v1

The versioned **vault capability contract** (`vault:v1`): the four generic verbs
over a PARA knowledge vault — **search**, **extract**, **organize**, **profile** —
declared once so a sandboxed component can supply them to any surface (CLI, TUI,
web, agent).

## Why this exists

Two independent PARA knowledge-vault POCs both need the same four verbs over a
vault, and refarm's `SourceProvider` (`source-contract-v1`) deliberately stops at
`resolve` / `materialize` / `status` / `refresh` — it has **no read, no search, no
extract**. `vault:v1` is that missing block. The vault-specific rules (a domain's
split/parse logic, a PARA routing map) never enter this contract; they ride in as
**matcher-is-data** profiles the host hands the surface, exactly like `quality:v1`.

## Two faces, one contract

- **Native (in-process)** — `src/types.ts`: `VaultSurface.run(verb, note, profile)`
  returns a `VaultResult`. `extract` emits `records-contract-v1` `KnowledgeRecord`s
  directly — the same nodes the silo already stores end to end.
- **Sovereign WASM** — `wit/vault.wit` (package `plugin:vault@0.1.0`, world
  `vault-surface`): the same `run`, exported by a component that **imports NOTHING**.
  That absence *is* the sandbox — an untrusted surface can only see the `note` the
  host hands it and return a result; it cannot touch the filesystem or network.

The two conform to the same behavior ("native ↔ WASM parity"). The reference
surface (`src/reference.ts`) implements one honest matcher per verb; the
conformance harness (`src/conformance.ts`) pins the boundary — determinism,
one-output-shape-per-verb, forward-safety — so the WASM component (built later via
`componentize-js` from the reference surface) has a fixed target.

## Verbs and outputs

| verb       | matcher (reference)      | output                         |
| ---------- | ------------------------ | ------------------------------ |
| `search`   | `contains`               | `VaultSearchHit[]`             |
| `extract`  | `frontmatter`            | `KnowledgeRecord[]`            |
| `organize` | `prefix-route`           | `VaultOrganizePlan[]`          |
| `profile`  | `requires`               | `VaultFinding[]`               |

An unknown `match.type` fires nothing (forward-safe): a newer profile's matcher
simply doesn't fire on an older surface, it never errors.

## Materializing notes

`planRecordFiles` renders a record's `fields` as YAML frontmatter. Nested values
are one compact JSON line by default — the form the reference surface's
`frontmatter` matcher can parse, and the one `organizeRecords` / `searchRecords`
always use.

Pass `blockStyle: true` when the notes are read by people: an invoice with
fifteen line items is one four-thousand-character line otherwise, which parses
perfectly and cannot be read. Scalars that YAML would retype — `[[Note]]` above
all, which unquoted is a nested flow sequence — are quoted in both forms.

## Status

TS-only foundation. The WASM component and its host dispatch (the sovereign
boundary proven the same deny-all way as `quality-checker-ref`) are a downstream
`§8` slice — this contract declares the boundary so that dispatch, when built,
targets a fixed shape.
