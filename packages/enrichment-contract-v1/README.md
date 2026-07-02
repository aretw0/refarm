# @refarm.dev/enrichment-contract-v1

Versioned `enrichment:v1` capability contract for deterministic record or note
enrichment.

The contract owns provider identity, input selection, dry-run/apply result
shape, diagnostics, and provenance. It does not own external registries,
credentials, note writing, PARA placement, or downstream vocabulary.

## Usage

```ts
import {
  ENRICHMENT_CAPABILITY,
  runEnrichmentV1Conformance,
  type EnrichmentProvider,
} from "@refarm.dev/enrichment-contract-v1";

export const provider: EnrichmentProvider = {
  pluginId: "@example/local-enrichment",
  capability: ENRICHMENT_CAPABILITY,
  describe() {
    return {
      providerId: "example.local-enrichment",
      needsKeyFrom: ["externalKey"],
      addsFields: ["status"],
    };
  },
  select(inputs) {
    return inputs.filter((input) => typeof input.fields.externalKey === "string");
  },
  async enrich(inputs, options = {}) {
    return {
      mode: options.mode ?? "dry-run",
      records: [],
      diagnostics: { total: inputs.length, enriched: 0, skipped: 0, byCode: {} },
    };
  },
};

const result = await runEnrichmentV1Conformance(provider);
```

## Reference Provider

`createReferenceEnrichmentProvider()` returns a deterministic fixture-backed
provider. It resolves an `externalKey` field against bundled local fixture data
and returns proposed field changes with provenance hashes. It performs no
network access and never writes notes.

## Boundary

This package owns:

- versioned TypeScript types;
- conformance checks;
- deterministic fixture provider;
- result diagnostics and provenance shape.

Host consumers own:

- persistence of returned changes;
- provider-specific lookups and credentials;
- domain fields, tags, review UX, and note placement.

`enrichment:v1` is a contract package with package-local checks and a named
downstream proof before handoff promotion.
