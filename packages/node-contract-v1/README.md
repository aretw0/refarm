# @refarm.dev/node-contract-v1

`node:v1` — the base shape every typed node of a local-first data graph
shares, in JSON-LD conventions (`@type`, `@id`), plus the normalised wire
form and the conversions between the two.

## Install

```bash
pnpm add @refarm.dev/node-contract-v1
```

## The model

```ts
import type { GraphNode } from "@refarm.dev/node-contract-v1";

const note: GraphNode = {
  "@type": "Note",
  "@id": "urn:note:2026-08-30-first",
  title: "First note",
  tags: ["inbox"],
  context_id: null,
  created_at_ns: 1_788_000_000_000_000_000,
};
```

Domain contracts (task, session, effort, records, …) extend `GraphNode` and
narrow or add fields; optional fields here may be required there.

## Normalised form

`NormalisedNode` is the persisted/wire shape (ISO timestamps, optional
`Signature`). `graphNodeToNormalised` / `normalisedToGraphNode` convert both
ways; `nanosToIso` / `isoToNanos` convert the timestamps alone.

```ts
import { graphNodeToNormalised, normalisedToGraphNode } from "@refarm.dev/node-contract-v1";

const wire = graphNodeToNormalised(note);
const back = normalisedToGraphNode(wire);
```

## Boundary

The contract names fields and conversions. Storage, sync, signing and the
domain vocabulary on top of `@type` stay with the host and its domain
contracts.
