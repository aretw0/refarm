# @refarm.dev/records-contract-v1

Versioned `records:v1` capability contract for neutral knowledge/content
manifests.

The contract defines record envelopes, sections, relations, attachments, source
references, content hashes, and review state. It does not define domain
vocabulary, storage, sync, PARA placement, editorial workflow, or rendering.

## Usage

```ts
import {
  RECORDS_CAPABILITY,
  runRecordsV1Conformance,
  type RecordsProvider,
} from "@refarm.dev/records-contract-v1";

export const provider: RecordsProvider = {
  pluginId: "@example/records",
  capability: RECORDS_CAPABILITY,
  validate(manifest) {
    return { ok: manifest.records.length > 0, failures: [] };
  },
  upcast(record) {
    return { ...record };
  },
};

const result = await runRecordsV1Conformance(provider);
```

## Reference Provider

`createReferenceRecordsProvider()` validates a sanitized fixture manifest with:

- JSON-LD-style `@type` and `@context`;
- sections and review state;
- relations with referential integrity;
- source refs and artifact-like attachment refs;
- stable content hashes;
- unknown field preservation across upcast.

The provider is in-memory and performs no storage, network access, source
materialization, or graph indexing.

## YAML-LD Codec Candidate

`@refarm.dev/records-contract-v1/yaml` provides the proof-backed YAML-LD codec for
YAML front matter and YAML documents that already carry the `records:v1` model.
It parses YAML-LD into a `KnowledgeRecord`, writes records back to YAML-LD, and
preserves unknown top-level keys for forward-safe consumers.

The codec also accepts lean consumer projections. When `schemaVersion` is
missing, parse helpers stamp the current `records:v1` schema version. When
`contentHash` is missing or empty, parse helpers compute it from the canonical
record content. A provided `contentHash` is preserved unless
`recomputeContentHash: true` is passed.

```ts
import {
  parseRecordsYamlLdFrontMatter,
  stringifyRecordsYamlLdFrontMatter,
} from "@refarm.dev/records-contract-v1/yaml";

const markdown = `---
id: record:note-1
@type: Note
fields:
  title: Example note
---
# Body
`;

const { record, body } = parseRecordsYamlLdFrontMatter(markdown);

record.schemaVersion; // current records:v1 schema version
record.contentHash; // computed because the lean projection omitted it

const serialized = stringifyRecordsYamlLdFrontMatter(record, body);
```

That keeps YAML-frontmatter bridges small while still returning a valid record
for conformance checks and downstream storage, enrichment, or source-linking
flows.

The codec subpath uses `yaml` as an optional peer dependency so consumers of the
base `records:v1` contract do not install YAML parsing code unless they opt into
`@refarm.dev/records-contract-v1/yaml`.

Consumer vocabularies stay outside the package. Hosts may pass `propertyKeyMap`
or `fieldKeyMap` when a vault uses local front-matter names, but this package
does not define those conventions. For example, a host can map a local `title`
front-matter key into `record.fields.title` without making `title` part of the
records contract:

```ts
const { record } = parseRecordsYamlLdFrontMatter(markdown, {
  fieldKeyMap: {
    title: "title",
  },
});
```

## Boundary

This package owns:

- versioned TypeScript types;
- conformance checks;
- deterministic reference fixture;
- forward-safety rules for open vocabulary and unknown fields;
- the generic YAML-LD serialization mechanism for the `records:v1` envelope.

Host consumers own:

- domain vocabulary and record types;
- storage/sync backends;
- editorial workflow and rendered notes;
- source and artifact dereferencing.

`records:v1` is a contract package with package-local checks and a named
downstream proof before handoff promotion.
