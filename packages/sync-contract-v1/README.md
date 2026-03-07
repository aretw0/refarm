# @refarm/sync-contract-v1

Versioned sync capability contract for Refarm plugin ecosystem.

## Installation

```bash
npm install @refarm/sync-contract-v1
```

## Usage

### For Plugin Implementers

Implement the `SyncProvider` interface and validate with conformance suite:

```typescript
import {
  runSyncV1Conformance,
  type SyncProvider,
  type SyncChange,
  type SyncSession,
  SYNC_CAPABILITY
} from "@refarm/sync-contract-v1";

export class MySyncProvider implements SyncProvider {
  readonly pluginId = "@mycompany/sync-websocket";
  readonly capability = SYNC_CAPABILITY;

  async connect(endpoint: string): Promise<SyncSession> {
    // Your implementation
  }

  async push(changes: SyncChange[]): Promise<void> {
    // Your implementation
  }

  async pull(): Promise<SyncChange[]> {
    // Your implementation
  }

  async disconnect(sessionId: string): Promise<void> {
    // Your implementation
  }
}

// Validate conformance
describe("MySyncProvider conformance", () => {
  it("passes sync:v1 contract", async () => {
    const provider = new MySyncProvider();
    const result = await runSyncV1Conformance(provider);
    
    expect(result.pass).toBe(true);
    if (!result.pass) {
      console.error("Conformance failures:", result.failures);
    }
  });
});
```

### For Consumers

Use any `sync:v1` compatible provider:

```typescript
import type { SyncProvider, SyncChange } from "@refarm/sync-contract-v1";
import { createMySyncProvider } from "@mycompany/sync-websocket";

const sync: SyncProvider = createMySyncProvider();

const session = await sync.connect("wss://sync.example.com");

await sync.push([
  {
    id: "change-1",
    timestamp: new Date().toISOString(),
    author: "user-123",
    operation: "put",
    resourceId: "note-456",
    data: { title: "Updated title" }
  }
]);

const remoteChanges = await sync.pull();
await sync.disconnect(session.sessionId);
```

## API

### `SyncProvider`

```typescript
interface SyncProvider {
  readonly pluginId: string;
  readonly capability: "sync:v1";
  
  connect(endpoint: string): Promise<SyncSession>;
  push(changes: SyncChange[]): Promise<void>;
  pull(): Promise<SyncChange[]>;
  disconnect(sessionId: string): Promise<void>;
}
```

### `SyncChange`

```typescript
interface SyncChange {
  id: string;
  timestamp: string;  // ISO 8601
  author: string;
  operation: "put" | "delete" | "update";
  resourceId: string;
  data?: unknown;
}
```

### `SyncSession`

```typescript
interface SyncSession {
  sessionId: string;
  peerId: string;
  startedAt: string;  // ISO 8601
}
```

### `runSyncV1Conformance(provider)`

Validates a provider implementation against `sync:v1` contract.

Returns `SyncConformanceResult`:
```typescript
{
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}
```

## Telemetry

Providers should emit telemetry events for observability:

```typescript
interface SyncTelemetryEvent {
  traceId: string;
  pluginId: string;
  capability: "sync:v1";
  operation: "connect" | "sync" | "disconnect" | "conflict";
  durationMs: number;
  ok: boolean;
  errorCode?: "CONFLICT" | "NETWORK_ERROR" | "AUTH_FAILED" | "TIMEOUT" | "INTERNAL";
}
```

## Versioning

This is `sync:v1`. Breaking changes will increment the capability version (e.g., `sync:v2`).

## License

MIT
