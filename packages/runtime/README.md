# @refarm.dev/runtime

Domain contract for host runtime state summaries. Lightweight, zero-dependency package used to assemble system prompts and expose Tractor's active namespace and database to consumers.

## When to use

- You need to represent the current runtime state (namespace, database, readiness) in a portable form.
- You are building a system prompt assembler or context provider that needs host runtime metadata.
- You are writing tests and need a null/default runtime summary.

## API

```typescript
import {
  type RuntimeSummary,
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
// { ready: true, databaseName: "refarm-personal.db", namespace: "personal" }
```

## License

MIT
