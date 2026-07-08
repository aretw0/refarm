# @refarm.dev/runtime

Runtime contracts and host-agnostic config resolution for SDK consumers. Tractor support lives behind an adapter; hosts can use the contracts without shipping that runtime.

## When to use

- You need to represent the current runtime state (namespace, database, readiness) in a portable form.
- You are building a system prompt assembler or context provider that needs host runtime metadata.
- You need reusable config precedence for runtime settings while keeping env names and config paths host-owned.
- You are writing tests and need a null/default runtime summary.

## API

```typescript
import {
  type RuntimeSummary,
  resolveRuntimeConfigValueAsync,
  createNullRuntimeSummary,
  createRuntimeSummaryFromTractor,
} from "@refarm.dev/runtime";
```

### `RuntimeSummary`

```typescript
interface RuntimeSummary {
  ready: boolean;
  databaseName: string;
  namespace: string;
}
```

### `createNullRuntimeSummary()`

Returns a not-ready, empty-namespace summary. Use in tests or before Tractor initializes.

```typescript
const summary = createNullRuntimeSummary();
// { ready: false, databaseName: "", namespace: "" }
```

### `createRuntimeSummaryFromTractor(tractor)`

Extracts runtime state from a live Tractor instance.

```typescript
import { createRuntimeSummaryFromTractor } from "@refarm.dev/runtime";

const summary = createRuntimeSummaryFromTractor(tractor);
// { ready: true, databaseName: "personal", namespace: "personal" }
```

## License

MIT
