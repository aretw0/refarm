# @refarm.dev/storage-contract-v1

Versioned storage capability contract for Refarm plugin ecosystem.

## Installation

```bash
npm install @refarm.dev/storage-contract-v1
```

## Usage

### For Plugin Implementers

Implement the `StorageProvider` interface and validate with conformance suite:

```typescript
import { 
  runStorageV1Conformance,
  type StorageProvider,
  type StorageRecord,
  type StorageQuery,
  STORAGE_CAPABILITY
} from "@refarm.dev/storage-contract-v1";

export class MyStorageProvider implements StorageProvider {
  readonly pluginId = "@mycompany/storage-custom";
  readonly capability = STORAGE_CAPABILITY;

  async get(id: string): Promise<StorageRecord | null> {
    // Your implementation
  }

  async put(record: StorageRecord): Promise<void> {
    // Your implementation
  }

  async delete(id: string): Promise<void> {
    // Your implementation
  }

  async query(query: StorageQuery): Promise<StorageRecord[]> {
    // Your implementation
  }
}

// Validate conformance in your test suite
describe("MyStorageProvider conformance", () => {
  it("passes storage:v1 contract", async () => {
    const provider = new MyStorageProvider();
    const result = await runStorageV1Conformance(provider);
    
    expect(result.pass).toBe(true);
    if (!result.pass) {
      console.error("Conformance failures:", result.failures);
    }
  });
});
```

### For Consumers

Use any `storage:v1` compatible provider:

```typescript
import type { StorageProvider } from "@refarm.dev/storage-contract-v1";
import { createMyStorageProvider } from "@mycompany/storage-custom";

const storage: StorageProvider = createMyStorageProvider();

await storage.put({
  id: "note-123",
  type: "note",
  payload: JSON.stringify({ title: "Hello", body: "World" }),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const note = await storage.get("note-123");
const allNotes = await storage.query({ type: "note", limit: 10 });
```

## API

### `StorageProvider`

```typescript
interface StorageProvider {
  readonly pluginId: string;
  readonly capability: "storage:v1";
  
  get(id: string): Promise<StorageRecord | null>;
  put(record: StorageRecord): Promise<void>;
  delete(id: string): Promise<void>;
  query(query: StorageQuery): Promise<StorageRecord[]>;
}
```

### `StorageRecord`

```typescript
interface StorageRecord {
  id: string;
  type: string;
  payload: string;
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
}
```

### `StorageQuery`

```typescript
interface StorageQuery {
  type?: string;
  limit?: number;
  offset?: number;
}
```

### `runStorageV1Conformance(provider)`

Validates a provider implementation against `storage:v1` contract.

Returns `StorageConformanceResult`:
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
interface StorageTelemetryEvent {
  traceId: string;
  pluginId: string;
  capability: "storage:v1";
  operation: "get" | "put" | "delete" | "query";
  durationMs: number;
  ok: boolean;
  errorCode?: "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT" | "UNAVAILABLE" | "INTERNAL";
}
```

## Versioning

This is `storage:v1`. Breaking changes will increment the capability version (e.g., `storage:v2`).

## License

MIT
