# Refarm Memory Storage (@refarm.dev/storage-memory)

This is a formal in-memory implementation of the `StorageProvider` (storage:v1) contract. It serves as both a reference implementation for plugin developers and a volatile storage primitive for testing and ephemeral sessions.

## Features

- **Volatile**: Data is lost when the process terminates.
- **Fast**: Zero-latency in-memory operations.
- **Conforming**: Passes the official `storage:v1` conformance suite.

## Getting Started

### 1. Installation

```bash
npm install @refarm.dev/storage-memory
```

### 2. Usage

```typescript
import { MemoryStorage } from "@refarm.dev/storage-memory";

const storage = new MemoryStorage();
await storage.put({ id: "note:1", type: "Note", data: { content: "Hello Memory!" } });
```

### 3. Build

```bash
npm run build
```

### 3. Running Conformance Tests

This package is validated against the official `storage:v1` contract.

```typescript
import { runStorageV1Conformance } from "@refarm.dev/storage-contract-v1";
import { MemoryStorage } from "@refarm.dev/storage-memory";

const provider = new MemoryStorage();
const result = await runStorageV1Conformance(provider);
console.log(result.pass ? "Conforms! ✅" : "Failed ❌");
```

## License

MIT
