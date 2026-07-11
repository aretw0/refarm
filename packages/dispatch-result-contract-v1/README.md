# @refarm.dev/dispatch-result-contract-v1

The neutral contract for the **asynchronous store-node result envelope** — the
shape every async plugin emits its result as, and the correlation helpers a caller
uses to read it back. The store-node sibling of `@refarm.dev/stream-contract-v1`
(the incremental STREAM model). See ADR-084.

## Why this exists

Per ADR-084, **asynchronous dispatch is the default plugin model**: a plugin runs
work off `on-event` and, because `on-event` returns nothing, emits its result OUT
as a graph node the caller reads back via `query-nodes`. The first async plugin
(vault) invented an ad-hoc `@type` + `replyRef` inline. Without a shared contract
every next plugin reinvents the correlation shape and callers hand-parse untyped
nodes. This formalizes it **once**.

## The contract

- **`DISPATCH_RESULT_TYPE`** (`DispatchResult`) — the canonical `@type` a
  caller queries.
- **`replyRef`** — the correlation id (typically the `effortId` or
  `<effortId>:<taskId>`) the caller submitted with, stamped on the result node so
  it maps back to its request. **Correlation is by content, not a derived
  filename** — there is no fragile naming formula a second plugin can get wrong
  (the failure mode the STREAM model still has).
- **`verb`** / **`result`** — the operation and its payload.

### Producer (a plugin)

```js
import { serializeDispatchResult } from "@refarm.dev/dispatch-result-contract-v1";
storeNode(serializeDispatchResult({ replyRef, verb, result }));
```

### Consumer (a caller)

```js
import { matchDispatchResults } from "@refarm.dev/dispatch-result-contract-v1";
const nodes = queryNodes(DISPATCH_RESULT_TYPE);        // host reads all of the type
const mine = matchDispatchResults(nodes, replyRef);    // keep only my results
```

`createInMemoryDispatchResultStore()` is the reference store — the test double a
plugin harness uses in place of the real `tractor-bridge`.

## Consumers

A contract needs real consumers to be a contract. Current: `@refarm.dev/vault-surface-ref`
(its `plugin.js` emits via `serializeDispatchResult`; its test correlates via
`matchDispatchResults`). More async plugins adopting it is what proves the shape.
