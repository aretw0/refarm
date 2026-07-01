# @refarm.dev/session-contract-v1

Versioned session capability contract (`session:v1`) and conformance helpers.

## Exports

- `SESSION_CAPABILITY`
- `runSessionV1Conformance(adapter)`
- `createInMemorySessionAdapter()`
- `planSessionContextFold(entries, options)`
- `unfoldSessionContextFold(fold, entries)`
- `digestSessionEntryContent(entry)`
- Session contract types (`Session`, `SessionEntry`, `SessionContractAdapter`, ...)

## Reversible Context Folding

`planSessionContextFold()` creates a deterministic fold plan for older session
entries while keeping a protected working tail unfolded. The fold stores entry
refs, content digests, range metadata, and an optional summary; it does not
delete entries or require a specific storage/runtime backend.

`unfoldSessionContextFold()` receives a fold plus candidate entries and returns
the recoverable entries in reference order, alongside missing entry IDs and
digest mismatches. This gives agents a reversible alternative to destructive
context compaction while leaving policy, persistence, and tool wiring to the
consumer.
