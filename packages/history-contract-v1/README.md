# @refarm.dev/history-contract-v1

`history:v1` — append-only **revisions** of a `KnowledgeRecord`: what changed between two
versions, and the timeline of changes.

A record's `contentHash` fingerprints one version, but nothing kept the *previous* version — so
"what changed between two pulls/edits" was unanswerable (`mergeRecords` replaced by id, the cache
kept only a hash, provenance overwrote its snapshot). This contract fills that gap.

## Model

- `RecordRevision` — one durable version: the full record `snapshot`, its `seq` (monotonic per
  record), `contentHash`, `parentHash` (the chain link), `recordedAt`, and `origin` (the verb).
- `RecordDiff` / `RecordFieldChange` — the structural diff of two versions (added / removed /
  changed) across `fields`, `sections`, `relations`, `attachments`, `review`, `sourceRefs`.

Snapshots are **complete**, not diff-forward: a full snapshot is the only honest way to
reconstruct a prior version (the repo has no structural delta-apply engine). Dedup by
`contentHash` keeps an identical re-save from creating a version; the diff is computed on demand.

## Functions (all pure)

- `diffRecords(before, after)` → `RecordDiff`
- `appendRevision(history, record, now, origin?)` → new history (dedup-by-hash inside)
- `makeRevision`, `latestRevision`, `timeline`, `revisionAt`
- `mergeAndRecord(manifest, incoming, now, origin?)` — the drop-in for the examples'
  hand-rolled `mergeRecords`: merges by id **and** appends a revision for each changed record.
  `revisions` rides on the manifest as an optional extra (non-breaking).

## Persistence

Revisions hang on the `RecordsManifest` as `revisions?` (`VersionedRecordsManifest`). The manifest
allows unknown extras, so a versioned manifest round-trips through the existing load/save with no
contract change. `revisionId` (`<recordId>@<contentHash>`) is unique per version, so a store that
upserts by id (a NodeView) becomes append-only — the migration path to a separate ledger at scale.
