# @refarm.dev/trust

Domain contract for trust profile and policy summaries. Lightweight, zero-dependency package used to assemble system prompts and runtime introspection payloads.

## When to use

- You need to represent the current trust state of the Refarm host in a portable, serializable form.
- You are building a system prompt assembler and need to inject the active security profile.
- You are writing tests and need a null/default trust summary.

## API

```typescript
import {
  type TrustSummary,
  createNullTrustSummary,
  createTrustSummaryFromTractor,
} from "@refarm.dev/trust";
```

### `TrustSummary`

```typescript
interface TrustSummary {
  profile: string;    // e.g. "default", "strict", "permissive"
  warnings: number;
  critical: number;
}
```

### `createNullTrustSummary(profile?)`

Returns a zero-warning, zero-critical summary. Use in tests or when Tractor is unavailable.

```typescript
const summary = createNullTrustSummary("default");
// { profile: "default", warnings: 0, critical: 0 }
```

### `createTrustSummaryFromTractor(tractor)`

Extracts trust state from a live Tractor instance.

```typescript
import { createTrustSummaryFromTractor } from "@refarm.dev/trust";

const summary = createTrustSummaryFromTractor(tractor);
```

## License

MIT
