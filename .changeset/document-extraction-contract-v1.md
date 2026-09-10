---
"@refarm.dev/document-extraction-contract-v1": minor
---

Add the `documento-extraido/v1` contract: the common envelope emitted by every domestic
financial document extractor (payslip, bank statement, invoice, NFC-e). The authority is the
JSON Schema published as data at `schema/documento-extraido-v1.json`, alongside a language-agnostic
conformance fixture suite (`fixtures/conformance.json`) and a thin TypeScript validator that
satisfies both, so a validator in another language (Python, for example) can prove itself against
the same two data files. Enters the `consumer-ready` release selection with a declared
`consumerPull`: the proof target is a consumer's Python validator for `documento-extraido/v1`
agreeing path-for-path with the vendored fixtures, while specific document extractors, business
logic over the `lancamentos`, and envelope persistence/sync/presentation stay downstream.
