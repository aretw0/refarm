# Third-Party Plugin Example

Demonstrates how external developers can use Refarm capability contracts to build and publish plugins.

## Setup

```bash
mkdir my-storage-plugin
cd my-storage-plugin
npm init -y
npm install @refarm/storage-contract-v1 --save
npm install typescript vitest --save-dev
```

## Implementation

**src/index.ts:**

```typescript
import {
  type StorageProvider,
  type StorageRecord,
  type StorageQuery,
  STORAGE_CAPABILITY,
} from "@refarm/storage-contract-v1";

export class MyStorageProvider implements StorageProvider {
  readonly pluginId = "@mycompany/storage-redis";
  readonly capability = STORAGE_CAPABILITY;

  private records = new Map<string, StorageRecord>();

  async get(id: string): Promise<StorageRecord | null> {
    return this.records.get(id) || null;
  }

  async put(record: StorageRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async query(query: StorageQuery): Promise<StorageRecord[]> {
    let results = Array.from(this.records.values());

    if (query.type) {
      results = results.filter((r) => r.type === query.type);
    }

    const offset = query.offset || 0;
    const limit = query.limit || results.length;

    return results.slice(offset, offset + limit);
  }
}

export function createMyStorageProvider(): StorageProvider {
  return new MyStorageProvider();
}
```

## Conformance Tests

**test/conformance.test.ts:**

```typescript
import { describe, it, expect } from "vitest";
import { runStorageV1Conformance } from "@refarm/storage-contract-v1";
import { MyStorageProvider } from "../src/index.js";

describe("MyStorageProvider conformance", () => {
  it("passes storage:v1 contract", async () => {
    const provider = new MyStorageProvider();
    const result = await runStorageV1Conformance(provider);

    expect(result.pass).toBe(true);

    if (!result.pass) {
      console.error("Conformance failures:");
      result.failures.forEach((failure) => console.error(`  - ${failure}`));
    }
  });
});
```

**vitest.config.ts:**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

## Build Configuration

**tsconfig.json:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

**package.json:**

```json
{
  "name": "@mycompany/storage-redis",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "type-check": "tsc --noEmit"
  },
  "files": ["dist", "README.md", "plugin-manifest.json"],
  "publishConfig": {
    "access": "public"
  },
  "dependencies": {
    "@refarm/storage-contract-v1": "^0.1.0"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^4.0.18"
  }
}
```

## Plugin Manifest

**plugin-manifest.json:**

```json
{
  "id": "@mycompany/storage-redis",
  "name": "Redis Storage Provider",
  "version": "1.0.0",
  "entry": "./dist/index.js",
  "capabilities": {
    "provides": ["storage:v1"],
    "requires": ["kernel:events"]
  },
  "permissions": ["storage:read", "storage:write"],
  "observability": {
    "hooks": ["onLoad", "onInit", "onRequest", "onError", "onTeardown"]
  }
}
```

Validate manifest:

```bash
npm install @refarm/plugin-manifest --save-dev
```

```typescript
import { assertValidPluginManifest } from "@refarm/plugin-manifest";
import manifest from "../plugin-manifest.json";

describe("Plugin manifest", () => {
  it("is valid", () => {
    expect(() => assertValidPluginManifest(manifest)).not.toThrow();
  });
});
```

## Publishing

```bash
npm run type-check  # Ensure types are valid
npm run test        # Ensure conformance passes
npm run build       # Build distribution
npm publish         # Publish to npm
```

## CI Integration (GitHub Actions)

**.github/workflows/test.yml:**

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run type-check
      - run: npm run test
```

## Usage by End Users

After publishing, users can install and use your plugin:

```bash
npm install @mycompany/storage-redis
```

```typescript
import { createMyStorageProvider } from "@mycompany/storage-redis";

const storage = createMyStorageProvider();

await storage.put({
  id: "note-123",
  type: "note",
  payload: JSON.stringify({ title: "Hello", body: "World" }),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const note = await storage.get("note-123");
```

## Best Practices

1. **Always run conformance tests** before publishing
2. **Validate plugin manifest** in CI
3. **Document observability hooks** (even if minimal initially)
4. **Version your capabilities** (storage:v1, storage:v2, etc.)
5. **Include telemetry** for debugging in production
6. **Test with real data** beyond conformance suite

## Support

- Contract packages: https://github.com/refarm-dev/refarm/tree/main/packages
- Plugin developer guide: https://github.com/refarm-dev/refarm/blob/main/docs/PLUGIN_DEVELOPER_PLAYBOOK.md
- ADR-018: Capability contracts: https://github.com/refarm-dev/refarm/blob/main/specs/ADRs/ADR-018-capability-contracts-and-observability-gates.md
