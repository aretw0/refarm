# @refarm.dev/source-oslc

Generic **OSLC / IBM Jazz** (ELM, DOORS-Next / RM, EWM / CCM, QM) read toolkit for the `source:v1`
capability. It speaks the OSLC 2.0 RDF request contract and the RDF/XML wire shape any Jazz
deployment emits — **protocol only, no vendor vocabulary**.

It builds on [`@refarm.dev/source-web`](../source-web) (the substrate that injects the fetch driver
and enforces egress/session/cache) and adds the reusable OSLC dialect on top:

- `oslcRequestHeaders` / `createOslcFetchDriver` — the OSLC RDF request contract; a non-OK response
  becomes an `HttpFetchError` so a **401 stays a recoverable re-auth signal** (expired Jazz session).
- `createOslcCrawlExtractor` (+ `oslcResourceRefs`, `isOslcArtifactUrl`, `isOslcCollectionUrl`) —
  walk a project's folder → artifact link graph, carrying the `Configuration-Context` per target.
- `splitOslcResourceBlocks` / `firstRdfMatch` / `oslcPrimaryTextToMarkdown` — generic RDF/XML parsing.
- `extractOslcRelationLinks` (+ `OSLC_RELATION_PREDICATES`) — OSLC traceability links → a neutral
  relation vocabulary (`elaborates` / `decomposes` / `satisfies` / …).
- `extractOslcAttachmentRef` — the binary coordinate a Jazz file artifact wraps.

## The sovereign boundary

This package owns the **generic OSLC protocol**. The **domain layer stays with the consumer** as
matcher-is-data: which `rdf:type` means what in your taxonomy, how a record id is derived, which
systems/project-areas exist, and any vendor authentication specifics (e.g. a corporate SSO's QR/token
payload) — none of that lives here. Refarm owns the generic; your vault owns the vocabulary.
