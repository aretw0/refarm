# @refarm.dev/provenance-contract-v1

**provenance:v1** — where a note came from. Any ingestion of dispersed data (a scraped
artifact, a feed item, an inbox message, a requirements pull) records its origin so the
note is auditable and sovereign.

This is the atom two independent note-boxes each carried **duplicated** in their own
frontmatter — evidence it wants to be one contract. The field names unify theirs
(`fonte_arquivo`/`fonte_caminho`/`link_origem`/`origem_*` and
`source`/`collectedAt`/`sha256`/`license`/`privacy`) under neutral, agnostic names.

## The model

```ts
interface NoteProvenance {
  channel: string;          // HOW it arrived (required): "web-scrape", "inbox", …
  sourceFile?: string;      // the origin file
  sourcePath?: string;      // the origin path
  originLink?: string;      // a canonical link back to the origin
  collectedAt?: string;     // ISO 8601
  contentSha256?: string;   // fingerprint to detect drift on re-ingest
  license?: string;
  privacy?: "public" | "internal" | "private" | "private-until-published" | string;
  [extra: string]: unknown; // a domain preserves extra origin facts without forking
}
```

`channel` is the one required field — a note always knows how it arrived. Everything else
is optional and omitted when absent (no `null` sentinels).

## Helpers (pure, dependency-light)

```ts
import { stampProvenance, readProvenance, verifyProvenance } from "@refarm.dev/provenance-contract-v1";

const fields = stampProvenance(record.fields, {   // under the reserved `provenance` key
  channel: "web-scrape", sourceFile: "demanda-42.html",
  originLink: "https://alm.example/artifact/42", collectedAt: new Date().toISOString(),
});
const prov = readProvenance(fields);               // back, or null
const { valid, checks } = verifyProvenance(prov);  // channel + shape checks
```

It rides on a record's `fields` (records-contract-v1) but is modeled standalone, so any
store — not just KnowledgeRecords — can carry provenance. `verifyProvenance` enforces the
required channel and shape-checks `collectedAt`/`contentSha256` only when present; the
"has an origin locator" check is soft (a channel-only note is still valid).

## Conformance

`runProvenanceV1Conformance()` runs the round-trip + check suite.
