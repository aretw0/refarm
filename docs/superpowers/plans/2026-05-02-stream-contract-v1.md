# Stream Contract v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the TypeScript streaming transport layer that makes Farmhand's in-process `StreamChunk` CRDT nodes consumable by CLI, SSE, and WebSocket clients.

**Architecture:** A canonical `stream-contract-v1` package defines `StreamChunk`, `StreamProducer`, `StreamConsumer`, `StreamTransportAdapter`, and a reusable conformance suite. A `StreamRegistry` in Farmhand bridges `tractor.onNode("StreamChunk")` to three bundled transports: File (NDJSON append + replay), SSE (GET /stream/:ref on port 42001), and WebSocket (WS /ws/stream on port 42001). The HTTP transports share the existing `HttpSidecar`; no new ports are needed.

**Tech Stack:** Node.js built-ins (`fs`, `http`), `ws` npm package (already a Farmhand dep), Vitest, TypeScript.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/stream-contract-v1/package.json` | Package manifest |
| Create | `packages/stream-contract-v1/tsconfig.json` | TS config |
| Create | `packages/stream-contract-v1/tsconfig.build.json` | Build config |
| Create | `packages/stream-contract-v1/src/types.ts` | `StreamChunk`, interfaces, `STREAM_CAPABILITY` |
| Create | `packages/stream-contract-v1/src/in-memory.ts` | `InMemoryStreamTransport` (reference impl) |
| Create | `packages/stream-contract-v1/src/conformance.ts` | `runConformanceTests()` |
| Create | `packages/stream-contract-v1/src/conformance.test.ts` | Runs conformance against `InMemoryStreamTransport` |
| Create | `packages/stream-contract-v1/src/index.ts` | Re-exports everything |
| Create | `packages/file-stream-transport/package.json` | Package manifest |
| Create | `packages/file-stream-transport/tsconfig.json` | TS config |
| Create | `packages/file-stream-transport/tsconfig.build.json` | Build config |
| Create | `packages/file-stream-transport/src/file-stream-transport.ts` | NDJSON write + in-memory sub dispatch + `replay()` |
| Create | `packages/file-stream-transport/src/file-stream-transport.test.ts` | Unit tests |
| Create | `packages/file-stream-transport/src/index.ts` | Re-export |
| Create | `packages/sse-stream-transport/package.json` | Package manifest |
| Create | `packages/sse-stream-transport/tsconfig.json` | TS config |
| Create | `packages/sse-stream-transport/tsconfig.build.json` | Build config |
| Create | `packages/sse-stream-transport/src/sse-stream-transport.ts` | SSE route handler + in-process subs |
| Create | `packages/sse-stream-transport/src/sse-stream-transport.test.ts` | Unit tests |
| Create | `packages/sse-stream-transport/src/index.ts` | Re-export |
| Create | `packages/ws-stream-transport/package.json` | Package manifest |
| Create | `packages/ws-stream-transport/tsconfig.json` | TS config |
| Create | `packages/ws-stream-transport/tsconfig.build.json` | Build config |
| Create | `packages/ws-stream-transport/src/ws-stream-transport.ts` | WebSocket upgrade handler + in-process subs |
| Create | `packages/ws-stream-transport/src/ws-stream-transport.test.ts` | Unit tests |
| Create | `packages/ws-stream-transport/src/index.ts` | Re-export |
| Create | `apps/farmhand/src/stream-registry.ts` | `StreamRegistry` — isolated dispatch to all adapters |
| Create | `apps/farmhand/src/stream-registry.test.ts` | Isolated-failure unit test |
| Create | `apps/farmhand/src/stream-chunk-mapper.ts` | `toStreamChunk()` — maps Tractor node → `StreamChunk` |
| Modify | `apps/farmhand/src/transports/http.ts` | Add `addRouteHandler()` + `get httpServer()` |
| Modify | `apps/farmhand/src/index.ts` | Register `StreamRegistry` + three transports + `tractor.onNode("StreamChunk")` |
| Modify | `apps/farmhand/package.json` | Add stream package deps |
| Modify | `scripts/ci/smoke-task-execution-loop.mjs` | Add pi-agent streaming smoke scenario |
| Modify | `specs/features/stream-contract-v1.md` | Mark SDD tasks done, status → In Progress |

---

## Task 1: `stream-contract-v1` — canonical contract package

**Files:**
- Create: `packages/stream-contract-v1/package.json`
- Create: `packages/stream-contract-v1/tsconfig.json`
- Create: `packages/stream-contract-v1/tsconfig.build.json`
- Create: `packages/stream-contract-v1/src/types.ts`
- Create: `packages/stream-contract-v1/src/in-memory.ts`
- Create: `packages/stream-contract-v1/src/conformance.ts`
- Create: `packages/stream-contract-v1/src/conformance.test.ts`
- Create: `packages/stream-contract-v1/src/index.ts`

- [ ] **Step 1: Create `packages/stream-contract-v1/package.json`**

```json
{
  "name": "@refarm.dev/stream-contract-v1",
  "version": "0.1.0",
  "description": "Versioned stream capability contract (stream:v1) and conformance suite",
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
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "lint": "tsc --noEmit",
    "type-check": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:unit": "vitest run --passWithNoTests",
    "clean": "rm -rf dist"
  },
  "keywords": ["plugin", "capability", "stream", "contract", "conformance"],
  "author": "Refarm Contributors",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aretw0/refarm.git",
    "directory": "packages/stream-contract-v1"
  },
  "files": ["dist", "README.md"],
  "publishConfig": { "access": "public" },
  "devDependencies": {
    "@refarm.dev/tsconfig": "*",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 2: Create `packages/stream-contract-v1/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "emitDeclarationOnly": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "baseUrl": "../.."
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/stream-contract-v1/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "noEmit": false,
    "emitDeclarationOnly": false,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `packages/stream-contract-v1/src/types.ts`**

```typescript
export const STREAM_CAPABILITY = "stream:v1" as const;

export interface StreamChunk {
  stream_ref: string;
  content: string;
  sequence: number;
  is_final: boolean;
  payload_kind?: "text_delta" | "final_text" | "final_tool_call" | "final_empty";
  metadata?: unknown;
}

export interface StreamProducer {
  write(chunk: StreamChunk): void;
}

export interface StreamConsumer {
  subscribe(
    stream_ref: string,
    onChunk: (chunk: StreamChunk) => void,
  ): () => void;
}

export interface StreamTransportAdapter extends StreamProducer, StreamConsumer {
  readonly capability: typeof STREAM_CAPABILITY;
}
```

- [ ] **Step 5: Create `packages/stream-contract-v1/src/in-memory.ts`**

```typescript
import { STREAM_CAPABILITY } from "./types.js";
import type { StreamChunk, StreamTransportAdapter } from "./types.js";

export class InMemoryStreamTransport implements StreamTransportAdapter {
  readonly capability = STREAM_CAPABILITY;
  private readonly stored = new Map<string, StreamChunk[]>();
  private readonly subs = new Map<string, Set<(chunk: StreamChunk) => void>>();

  write(chunk: StreamChunk): void {
    const list = this.stored.get(chunk.stream_ref) ?? [];
    list.push(chunk);
    this.stored.set(chunk.stream_ref, list);
    for (const cb of this.subs.get(chunk.stream_ref) ?? []) {
      cb(chunk);
    }
  }

  subscribe(
    stream_ref: string,
    onChunk: (chunk: StreamChunk) => void,
  ): () => void {
    for (const chunk of this.stored.get(stream_ref) ?? []) {
      onChunk(chunk);
    }
    const set = this.subs.get(stream_ref) ?? new Set();
    set.add(onChunk);
    this.subs.set(stream_ref, set);
    return () => set.delete(onChunk);
  }
}
```

- [ ] **Step 6: Create `packages/stream-contract-v1/src/conformance.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { STREAM_CAPABILITY } from "./types.js";
import type { StreamChunk, StreamTransportAdapter } from "./types.js";

export function runConformanceTests(
  suiteName: string,
  factory: () => StreamTransportAdapter,
): void {
  describe(`${suiteName} — stream:v1 conformance`, () => {
    it("has capability marker", () => {
      expect(factory().capability).toBe(STREAM_CAPABILITY);
    });

    it("delivers a chunk to a subscriber", () => {
      const t = factory();
      const received: StreamChunk[] = [];
      t.subscribe("ref-a", (c) => received.push(c));
      t.write({ stream_ref: "ref-a", content: "hello", sequence: 0, is_final: false });
      expect(received).toHaveLength(1);
      expect(received[0].content).toBe("hello");
    });

    it("replays past chunks on late subscribe", () => {
      const t = factory();
      t.write({ stream_ref: "ref-b", content: "a", sequence: 0, is_final: false });
      t.write({ stream_ref: "ref-b", content: "b", sequence: 1, is_final: false });
      const received: StreamChunk[] = [];
      t.subscribe("ref-b", (c) => received.push(c));
      expect(received).toHaveLength(2);
      expect(received.map((c) => c.content)).toEqual(["a", "b"]);
    });

    it("delivers final chunk and signals completion", () => {
      const t = factory();
      const received: StreamChunk[] = [];
      t.subscribe("ref-c", (c) => received.push(c));
      t.write({ stream_ref: "ref-c", content: "last", sequence: 0, is_final: true });
      expect(received[received.length - 1].is_final).toBe(true);
    });

    it("delivers to multiple subscribers for same stream_ref", () => {
      const t = factory();
      const r1: StreamChunk[] = [];
      const r2: StreamChunk[] = [];
      t.subscribe("ref-d", (c) => r1.push(c));
      t.subscribe("ref-d", (c) => r2.push(c));
      t.write({ stream_ref: "ref-d", content: "x", sequence: 0, is_final: false });
      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
    });

    it("maintains sequence order under rapid writes", () => {
      const t = factory();
      const seqs: number[] = [];
      t.subscribe("ref-e", (c) => seqs.push(c.sequence));
      for (let i = 0; i < 5; i++) {
        t.write({ stream_ref: "ref-e", content: `c${i}`, sequence: i, is_final: i === 4 });
      }
      expect(seqs).toEqual([0, 1, 2, 3, 4]);
    });
  });
}
```

- [ ] **Step 7: Create `packages/stream-contract-v1/src/conformance.test.ts`**

```typescript
import { InMemoryStreamTransport } from "./in-memory.js";
import { runConformanceTests } from "./conformance.js";

runConformanceTests("InMemoryStreamTransport", () => new InMemoryStreamTransport());
```

- [ ] **Step 8: Create `packages/stream-contract-v1/src/index.ts`**

```typescript
export { STREAM_CAPABILITY } from "./types.js";
export type {
  StreamChunk,
  StreamConsumer,
  StreamProducer,
  StreamTransportAdapter,
} from "./types.js";
export { InMemoryStreamTransport } from "./in-memory.js";
export { runConformanceTests } from "./conformance.js";
```

- [ ] **Step 9: Run tests**

```bash
cd packages/stream-contract-v1 && npx vitest run
```

Expected: 6 tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/stream-contract-v1/
git commit -m "feat(stream): scaffold stream-contract-v1 — types, InMemory, conformance suite"
```

---

## Task 2: `file-stream-transport` package

**Files:**
- Create: `packages/file-stream-transport/package.json`
- Create: `packages/file-stream-transport/tsconfig.json`
- Create: `packages/file-stream-transport/tsconfig.build.json`
- Create: `packages/file-stream-transport/src/file-stream-transport.ts`
- Create: `packages/file-stream-transport/src/file-stream-transport.test.ts`
- Create: `packages/file-stream-transport/src/index.ts`

- [ ] **Step 1: Create `packages/file-stream-transport/package.json`**

```json
{
  "name": "@refarm.dev/file-stream-transport",
  "version": "0.1.0",
  "description": "NDJSON file-backed StreamTransportAdapter with replay",
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
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "lint": "tsc --noEmit",
    "type-check": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:unit": "vitest run --passWithNoTests",
    "clean": "rm -rf dist"
  },
  "keywords": ["stream", "transport", "ndjson", "file"],
  "author": "Refarm Contributors",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aretw0/refarm.git",
    "directory": "packages/file-stream-transport"
  },
  "files": ["dist", "README.md"],
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@refarm.dev/stream-contract-v1": "*"
  },
  "devDependencies": {
    "@refarm.dev/tsconfig": "*",
    "@types/node": "^25.6.0",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 2: Create `packages/file-stream-transport/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "emitDeclarationOnly": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "baseUrl": "../.."
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/file-stream-transport/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "noEmit": false,
    "emitDeclarationOnly": false,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Write failing test — `packages/file-stream-transport/src/file-stream-transport.test.ts`**

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileStreamTransport } from "./file-stream-transport.js";
import { runConformanceTests } from "@refarm.dev/stream-contract-v1";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "file-stream-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// Conformance suite
runConformanceTests("FileStreamTransport", () => new FileStreamTransport(tempDir));

describe("FileStreamTransport — file persistence", () => {
  it("writes chunks to NDJSON file", () => {
    const t = new FileStreamTransport(tempDir);
    t.write({ stream_ref: "s1", content: "hello", sequence: 0, is_final: false });
    t.write({ stream_ref: "s1", content: "world", sequence: 1, is_final: true });
    const chunks = t.replay("s1");
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toBe("hello");
    expect(chunks[1].content).toBe("world");
  });

  it("replay returns empty array for unknown stream_ref", () => {
    const t = new FileStreamTransport(tempDir);
    expect(t.replay("unknown")).toEqual([]);
  });

  it("late-subscribe replays persisted chunks in order", () => {
    const writer = new FileStreamTransport(tempDir);
    writer.write({ stream_ref: "s2", content: "a", sequence: 0, is_final: false });
    writer.write({ stream_ref: "s2", content: "b", sequence: 1, is_final: false });

    const reader = new FileStreamTransport(tempDir);
    const received: string[] = [];
    reader.subscribe("s2", (c) => received.push(c.content));
    expect(received).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
cd packages/file-stream-transport && npx vitest run
```

Expected: FAIL — `FileStreamTransport` does not exist yet.

- [ ] **Step 6: Implement `packages/file-stream-transport/src/file-stream-transport.ts`**

```typescript
import fs from "node:fs";
import path from "node:path";
import {
  STREAM_CAPABILITY,
  type StreamChunk,
  type StreamTransportAdapter,
} from "@refarm.dev/stream-contract-v1";

export class FileStreamTransport implements StreamTransportAdapter {
  readonly capability = STREAM_CAPABILITY;
  private readonly subs = new Map<string, Set<(chunk: StreamChunk) => void>>();

  constructor(private readonly baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  private filePath(stream_ref: string): string {
    return path.join(this.baseDir, `${stream_ref}.ndjson`);
  }

  write(chunk: StreamChunk): void {
    fs.appendFileSync(this.filePath(chunk.stream_ref), JSON.stringify(chunk) + "\n");
    for (const cb of this.subs.get(chunk.stream_ref) ?? []) {
      cb(chunk);
    }
  }

  subscribe(
    stream_ref: string,
    onChunk: (chunk: StreamChunk) => void,
  ): () => void {
    for (const chunk of this.replay(stream_ref)) {
      onChunk(chunk);
    }
    const set = this.subs.get(stream_ref) ?? new Set();
    set.add(onChunk);
    this.subs.set(stream_ref, set);
    return () => set.delete(onChunk);
  }

  /** Returns all stored chunks for a stream_ref (used for SSE/WS replay). */
  replay(stream_ref: string): StreamChunk[] {
    const fp = this.filePath(stream_ref);
    if (!fs.existsSync(fp)) return [];
    return fs
      .readFileSync(fp, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StreamChunk);
  }
}
```

- [ ] **Step 7: Create `packages/file-stream-transport/src/index.ts`**

```typescript
export { FileStreamTransport } from "./file-stream-transport.js";
```

- [ ] **Step 8: Run tests**

```bash
cd packages/file-stream-transport && npx vitest run
```

Expected: all tests pass (conformance suite + persistence tests).

- [ ] **Step 9: Commit**

```bash
git add packages/file-stream-transport/
git commit -m "feat(stream): add file-stream-transport — NDJSON write/replay + conformance"
```

---

## Task 3: `sse-stream-transport` package

**Files:**
- Create: `packages/sse-stream-transport/package.json`
- Create: `packages/sse-stream-transport/tsconfig.json`
- Create: `packages/sse-stream-transport/tsconfig.build.json`
- Create: `packages/sse-stream-transport/src/sse-stream-transport.ts`
- Create: `packages/sse-stream-transport/src/sse-stream-transport.test.ts`
- Create: `packages/sse-stream-transport/src/index.ts`

- [ ] **Step 1: Create `packages/sse-stream-transport/package.json`**

```json
{
  "name": "@refarm.dev/sse-stream-transport",
  "version": "0.1.0",
  "description": "Server-Sent Events StreamTransportAdapter for Farmhand HTTP sidecar",
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
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "lint": "tsc --noEmit",
    "type-check": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:unit": "vitest run --passWithNoTests",
    "clean": "rm -rf dist"
  },
  "keywords": ["stream", "transport", "sse", "server-sent-events"],
  "author": "Refarm Contributors",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aretw0/refarm.git",
    "directory": "packages/sse-stream-transport"
  },
  "files": ["dist", "README.md"],
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@refarm.dev/stream-contract-v1": "*",
    "@refarm.dev/file-stream-transport": "*"
  },
  "devDependencies": {
    "@refarm.dev/tsconfig": "*",
    "@types/node": "^25.6.0",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 2: Create tsconfig files** — same pattern as `file-stream-transport` (copy `tsconfig.json` and `tsconfig.build.json` from Task 2, they are identical across packages).

`packages/sse-stream-transport/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "emitDeclarationOnly": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "baseUrl": "../.."
  },
  "include": ["src/**/*"]
}
```

`packages/sse-stream-transport/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "noEmit": false,
    "emitDeclarationOnly": false,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write failing test — `packages/sse-stream-transport/src/sse-stream-transport.test.ts`**

```typescript
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileStreamTransport } from "@refarm.dev/file-stream-transport";
import { SseStreamTransport } from "./sse-stream-transport.js";
import { runConformanceTests } from "@refarm.dev/stream-contract-v1";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sse-stream-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// Conformance suite using in-process subscribe
runConformanceTests("SseStreamTransport", () => new SseStreamTransport(null));

describe("SseStreamTransport — HTTP route handler", () => {
  it("returns false for non-matching routes", () => {
    const t = new SseStreamTransport(null);
    const handler = t.getRouteHandler();
    const req = { method: "GET", url: "/other" } as http.IncomingMessage;
    const res = { writeHead: () => {}, write: () => {}, end: () => {} } as unknown as http.ServerResponse;
    expect(handler(req, res)).toBe(false);
  });

  it("returns true and writes SSE headers for /stream/:ref", () => {
    const t = new SseStreamTransport(null);
    const handler = t.getRouteHandler();

    let headers: Record<string, string> = {};
    const req = { method: "GET", url: "/stream/my-ref", on: () => {} } as unknown as http.IncomingMessage;
    const res = {
      writeHead: (_code: number, h: Record<string, string>) => { headers = h; },
      write: () => {},
      end: () => {},
    } as unknown as http.ServerResponse;

    expect(handler(req, res)).toBe(true);
    expect(headers["Content-Type"]).toBe("text/event-stream");
  });

  it("pushes SSE data frame to connected client on write()", () => {
    const t = new SseStreamTransport(null);
    const handler = t.getRouteHandler();

    const written: string[] = [];
    const req = { method: "GET", url: "/stream/r1", on: () => {} } as unknown as http.IncomingMessage;
    const res = {
      writeHead: () => {},
      write: (d: string) => written.push(d),
      end: () => {},
    } as unknown as http.ServerResponse;

    handler(req, res);
    t.write({ stream_ref: "r1", content: "tok", sequence: 0, is_final: false });

    expect(written.some((d) => d.includes('"content":"tok"'))).toBe(true);
  });

  it("sends [DONE] frame and closes on is_final", () => {
    const t = new SseStreamTransport(null);
    const handler = t.getRouteHandler();

    const written: string[] = [];
    let ended = false;
    const req = { method: "GET", url: "/stream/r2", on: () => {} } as unknown as http.IncomingMessage;
    const res = {
      writeHead: () => {},
      write: (d: string) => written.push(d),
      end: () => { ended = true; },
    } as unknown as http.ServerResponse;

    handler(req, res);
    t.write({ stream_ref: "r2", content: "last", sequence: 0, is_final: true });

    expect(written.some((d) => d.includes("[DONE]"))).toBe(true);
    expect(ended).toBe(true);
  });

  it("replays chunks from FileStreamTransport on SSE connect", () => {
    const fileT = new FileStreamTransport(tempDir);
    fileT.write({ stream_ref: "r3", content: "past", sequence: 0, is_final: false });

    const t = new SseStreamTransport(fileT);
    const handler = t.getRouteHandler();

    const written: string[] = [];
    const req = { method: "GET", url: "/stream/r3", on: () => {} } as unknown as http.IncomingMessage;
    const res = {
      writeHead: () => {},
      write: (d: string) => written.push(d),
      end: () => {},
    } as unknown as http.ServerResponse;

    handler(req, res);
    expect(written.some((d) => d.includes('"content":"past"'))).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd packages/sse-stream-transport && npx vitest run
```

Expected: FAIL — `SseStreamTransport` does not exist yet.

- [ ] **Step 5: Implement `packages/sse-stream-transport/src/sse-stream-transport.ts`**

```typescript
import type http from "node:http";
import {
  STREAM_CAPABILITY,
  type StreamChunk,
  type StreamTransportAdapter,
} from "@refarm.dev/stream-contract-v1";
import type { FileStreamTransport } from "@refarm.dev/file-stream-transport";

export type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => boolean;

export class SseStreamTransport implements StreamTransportAdapter {
  readonly capability = STREAM_CAPABILITY;
  private readonly connections = new Map<string, Set<http.ServerResponse>>();
  private readonly inProcess = new Map<string, Set<(chunk: StreamChunk) => void>>();

  constructor(private readonly fileTransport: FileStreamTransport | null) {}

  write(chunk: StreamChunk): void {
    const data = `data: ${JSON.stringify(chunk)}\n\n`;
    for (const res of this.connections.get(chunk.stream_ref) ?? []) {
      res.write(data);
      if (chunk.is_final) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    }
    if (chunk.is_final) {
      this.connections.delete(chunk.stream_ref);
    }
    for (const cb of this.inProcess.get(chunk.stream_ref) ?? []) {
      cb(chunk);
    }
  }

  subscribe(
    stream_ref: string,
    onChunk: (chunk: StreamChunk) => void,
  ): () => void {
    if (this.fileTransport) {
      for (const chunk of this.fileTransport.replay(stream_ref)) {
        onChunk(chunk);
      }
    }
    const set = this.inProcess.get(stream_ref) ?? new Set();
    set.add(onChunk);
    this.inProcess.set(stream_ref, set);
    return () => set.delete(onChunk);
  }

  /** Returns a handler to register with HttpSidecar.addRouteHandler(). */
  getRouteHandler(): RouteHandler {
    return (req, res) => {
      const match = req.url?.match(/^\/stream\/(.+)$/);
      if (!match || req.method !== "GET") return false;
      const stream_ref = decodeURIComponent(match[1]);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      if (this.fileTransport) {
        for (const chunk of this.fileTransport.replay(stream_ref)) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      }

      const set = this.connections.get(stream_ref) ?? new Set();
      set.add(res);
      this.connections.set(stream_ref, set);

      const heartbeat = setInterval(() => {
        res.write(": heartbeat\n\n");
      }, 15_000);

      req.on("close", () => {
        clearInterval(heartbeat);
        this.connections.get(stream_ref)?.delete(res);
      });

      return true;
    };
  }
}
```

- [ ] **Step 6: Create `packages/sse-stream-transport/src/index.ts`**

```typescript
export { SseStreamTransport } from "./sse-stream-transport.js";
export type { RouteHandler } from "./sse-stream-transport.js";
```

- [ ] **Step 7: Run tests**

```bash
cd packages/sse-stream-transport && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/sse-stream-transport/
git commit -m "feat(stream): add sse-stream-transport — GET /stream/:ref with replay and [DONE] frame"
```

---

## Task 4: `ws-stream-transport` package

**Files:**
- Create: `packages/ws-stream-transport/package.json`
- Create: `packages/ws-stream-transport/tsconfig.json`
- Create: `packages/ws-stream-transport/tsconfig.build.json`
- Create: `packages/ws-stream-transport/src/ws-stream-transport.ts`
- Create: `packages/ws-stream-transport/src/ws-stream-transport.test.ts`
- Create: `packages/ws-stream-transport/src/index.ts`

- [ ] **Step 1: Create `packages/ws-stream-transport/package.json`**

```json
{
  "name": "@refarm.dev/ws-stream-transport",
  "version": "0.1.0",
  "description": "WebSocket StreamTransportAdapter for Farmhand HTTP sidecar",
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
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "lint": "tsc --noEmit",
    "type-check": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "test:unit": "vitest run --passWithNoTests",
    "clean": "rm -rf dist"
  },
  "keywords": ["stream", "transport", "websocket"],
  "author": "Refarm Contributors",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aretw0/refarm.git",
    "directory": "packages/ws-stream-transport"
  },
  "files": ["dist", "README.md"],
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@refarm.dev/stream-contract-v1": "*",
    "@refarm.dev/file-stream-transport": "*",
    "ws": "^8.20.0"
  },
  "devDependencies": {
    "@refarm.dev/tsconfig": "*",
    "@types/node": "^25.6.0",
    "@types/ws": "^8.18.1",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 2: Create tsconfig files** — same pattern as Tasks 2 and 3.

`packages/ws-stream-transport/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "emitDeclarationOnly": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "baseUrl": "../.."
  },
  "include": ["src/**/*"]
}
```

`packages/ws-stream-transport/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "noEmit": false,
    "emitDeclarationOnly": false,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write failing test — `packages/ws-stream-transport/src/ws-stream-transport.test.ts`**

```typescript
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { FileStreamTransport } from "@refarm.dev/file-stream-transport";
import { WsStreamTransport } from "./ws-stream-transport.js";
import { runConformanceTests } from "@refarm.dev/stream-contract-v1";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ws-stream-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// Conformance suite using in-process subscribe (no real server needed)
runConformanceTests("WsStreamTransport (in-process)", () => {
  const server = http.createServer();
  return new WsStreamTransport(server, null);
});

describe("WsStreamTransport — WebSocket protocol", () => {
  it("delivers chunk to subscribed WS client", async () => {
    const server = http.createServer();
    const transport = new WsStreamTransport(server, null);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const received: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
    await new Promise<void>((resolve) => ws.on("open", resolve));
    ws.send(JSON.stringify({ action: "subscribe", stream_ref: "ws-ref1" }));
    ws.on("message", (data) => received.push(data.toString()));

    await new Promise((r) => setTimeout(r, 20));
    transport.write({ stream_ref: "ws-ref1", content: "hello", sequence: 0, is_final: false });
    await new Promise((r) => setTimeout(r, 20));

    expect(received.some((m) => m.includes('"content":"hello"'))).toBe(true);
    ws.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("closes WS connection with code 1000 on is_final", async () => {
    const server = http.createServer();
    const transport = new WsStreamTransport(server, null);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    let closeCode: number | undefined;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
    await new Promise<void>((resolve) => ws.on("open", resolve));
    ws.send(JSON.stringify({ action: "subscribe", stream_ref: "ws-ref2" }));
    ws.on("close", (code) => { closeCode = code; });

    await new Promise((r) => setTimeout(r, 20));
    transport.write({ stream_ref: "ws-ref2", content: "last", sequence: 0, is_final: true });
    await new Promise((r) => setTimeout(r, 50));

    expect(closeCode).toBe(1000);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("replays past chunks from FileStreamTransport on subscribe", async () => {
    const fileT = new FileStreamTransport(tempDir);
    fileT.write({ stream_ref: "ws-ref3", content: "past", sequence: 0, is_final: false });

    const server = http.createServer();
    const transport = new WsStreamTransport(server, fileT);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const received: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
    await new Promise<void>((resolve) => ws.on("open", resolve));
    ws.on("message", (data) => received.push(data.toString()));
    ws.send(JSON.stringify({ action: "subscribe", stream_ref: "ws-ref3" }));
    await new Promise((r) => setTimeout(r, 30));

    expect(received.some((m) => m.includes('"content":"past"'))).toBe(true);
    ws.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd packages/ws-stream-transport && npx vitest run
```

Expected: FAIL — `WsStreamTransport` does not exist yet.

- [ ] **Step 5: Implement `packages/ws-stream-transport/src/ws-stream-transport.ts`**

```typescript
import type http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  STREAM_CAPABILITY,
  type StreamChunk,
  type StreamTransportAdapter,
} from "@refarm.dev/stream-contract-v1";
import type { FileStreamTransport } from "@refarm.dev/file-stream-transport";

export class WsStreamTransport implements StreamTransportAdapter {
  readonly capability = STREAM_CAPABILITY;
  private readonly wss: WebSocketServer;
  private readonly wsSubscribers = new Map<string, Set<WebSocket>>();
  private readonly inProcess = new Map<string, Set<(chunk: StreamChunk) => void>>();

  constructor(
    server: http.Server,
    private readonly fileTransport: FileStreamTransport | null,
  ) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      if (req.url !== "/ws/stream") return;
      this.wss.handleUpgrade(req, socket as import("node:stream").Duplex, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });

    this.wss.on("connection", (ws) => {
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as {
            action: string;
            stream_ref: string;
          };
          if (msg.action !== "subscribe" || !msg.stream_ref) return;

          if (this.fileTransport) {
            for (const chunk of this.fileTransport.replay(msg.stream_ref)) {
              ws.send(JSON.stringify(chunk));
            }
          }

          const set = this.wsSubscribers.get(msg.stream_ref) ?? new Set();
          set.add(ws);
          this.wsSubscribers.set(msg.stream_ref, set);
          ws.on("close", () => set.delete(ws));
        } catch {
          // ignore malformed messages
        }
      });
    });
  }

  write(chunk: StreamChunk): void {
    const json = JSON.stringify(chunk);
    for (const ws of this.wsSubscribers.get(chunk.stream_ref) ?? []) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(json);
        if (chunk.is_final) ws.close(1000);
      }
    }
    if (chunk.is_final) this.wsSubscribers.delete(chunk.stream_ref);
    for (const cb of this.inProcess.get(chunk.stream_ref) ?? []) {
      cb(chunk);
    }
  }

  subscribe(
    stream_ref: string,
    onChunk: (chunk: StreamChunk) => void,
  ): () => void {
    if (this.fileTransport) {
      for (const chunk of this.fileTransport.replay(stream_ref)) {
        onChunk(chunk);
      }
    }
    const set = this.inProcess.get(stream_ref) ?? new Set();
    set.add(onChunk);
    this.inProcess.set(stream_ref, set);
    return () => set.delete(onChunk);
  }
}
```

- [ ] **Step 6: Create `packages/ws-stream-transport/src/index.ts`**

```typescript
export { WsStreamTransport } from "./ws-stream-transport.js";
```

- [ ] **Step 7: Run tests**

```bash
cd packages/ws-stream-transport && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/ws-stream-transport/
git commit -m "feat(stream): add ws-stream-transport — WebSocket upgrade, subscribe handshake, replay"
```

---

## Task 5: `StreamRegistry` + extend `HttpSidecar`

**Files:**
- Create: `apps/farmhand/src/stream-registry.ts`
- Create: `apps/farmhand/src/stream-registry.test.ts`
- Modify: `apps/farmhand/src/transports/http.ts`

- [ ] **Step 1: Write failing test — `apps/farmhand/src/stream-registry.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { StreamRegistry } from "./stream-registry.js";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";

const chunk: StreamChunk = {
  stream_ref: "test-ref",
  content: "hello",
  sequence: 0,
  is_final: false,
};

describe("StreamRegistry", () => {
  it("dispatches a chunk to all registered adapters", () => {
    const registry = new StreamRegistry();
    const write1 = vi.fn();
    const write2 = vi.fn();
    registry.register({ write: write1 });
    registry.register({ write: write2 });
    registry.dispatch(chunk);
    expect(write1).toHaveBeenCalledWith(chunk);
    expect(write2).toHaveBeenCalledWith(chunk);
  });

  it("continues dispatching when one adapter throws", () => {
    const registry = new StreamRegistry();
    const throwing = { write: vi.fn().mockImplementation(() => { throw new Error("boom"); }) };
    const working = { write: vi.fn() };
    registry.register(throwing);
    registry.register(working);
    expect(() => registry.dispatch(chunk)).not.toThrow();
    expect(working.write).toHaveBeenCalledWith(chunk);
  });

  it("dispatches to adapters registered after creation", () => {
    const registry = new StreamRegistry();
    registry.dispatch(chunk); // no-op, no adapters yet
    const write = vi.fn();
    registry.register({ write });
    registry.dispatch(chunk);
    expect(write).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/farmhand && npx vitest run src/stream-registry.test.ts
```

Expected: FAIL — `StreamRegistry` does not exist yet.

- [ ] **Step 3: Implement `apps/farmhand/src/stream-registry.ts`**

```typescript
import type { StreamChunk, StreamProducer } from "@refarm.dev/stream-contract-v1";

export class StreamRegistry {
  private readonly adapters: StreamProducer[] = [];

  register(adapter: StreamProducer): void {
    this.adapters.push(adapter);
  }

  dispatch(chunk: StreamChunk): void {
    for (const adapter of this.adapters) {
      try {
        adapter.write(chunk);
      } catch {
        // isolated — one broken adapter never silences others
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/farmhand && npx vitest run src/stream-registry.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Extend `apps/farmhand/src/transports/http.ts`**

Locate the `HttpSidecar` class and add two things:

**a) A `routeHandlers` array and `addRouteHandler` method.** Find the class definition and add after the `server` field:

```typescript
private readonly routeHandlers: Array<
  (req: http.IncomingMessage, res: http.ServerResponse) => boolean
> = [];

addRouteHandler(
  fn: (req: http.IncomingMessage, res: http.ServerResponse) => boolean,
): void {
  this.routeHandlers.push(fn);
}

get httpServer(): http.Server {
  return this.server;
}
```

**b) Call route handlers at the top of `handle()`**, before the existing routing. Find the `private async handle(...)` method and prepend:

```typescript
for (const handler of this.routeHandlers) {
  if (handler(req, res)) return;
}
```

The full modified top of `handle()` should look like:

```typescript
private async handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = req.url ?? "/";

  try {
    for (const handler of this.routeHandlers) {
      if (handler(req, res)) return;
    }

    if (req.method === "POST" && url === "/efforts") {
      // ... existing code continues unchanged
```

- [ ] **Step 6: Commit**

```bash
git add apps/farmhand/src/stream-registry.ts apps/farmhand/src/stream-registry.test.ts apps/farmhand/src/transports/http.ts
git commit -m "feat(stream): add StreamRegistry + extend HttpSidecar with addRouteHandler/httpServer"
```

---

## Task 6: Wire Farmhand — mapper, CRDT bridge, transport registration

**Files:**
- Create: `apps/farmhand/src/stream-chunk-mapper.ts`
- Modify: `apps/farmhand/src/index.ts`
- Modify: `apps/farmhand/package.json`

- [ ] **Step 1: Add stream package deps to `apps/farmhand/package.json`**

Add to `"dependencies"`:

```json
"@refarm.dev/stream-contract-v1": "*",
"@refarm.dev/file-stream-transport": "*",
"@refarm.dev/sse-stream-transport": "*",
"@refarm.dev/ws-stream-transport": "*"
```

- [ ] **Step 2: Create `apps/farmhand/src/stream-chunk-mapper.ts`**

This maps a Tractor CRDT node (which arrives as `Record<string, unknown>` and matches `StreamChunkEvent` from `@refarm.dev/tractor-ts`) to the canonical `StreamChunk` from `stream-contract-v1`.

```typescript
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";

export function toStreamChunk(node: Record<string, unknown>): StreamChunk {
  return {
    stream_ref:
      typeof node["stream_ref"] === "string" ? node["stream_ref"] : "",
    content: typeof node["content"] === "string" ? node["content"] : "",
    sequence: typeof node["sequence"] === "number" ? node["sequence"] : 0,
    is_final: node["is_final"] === true,
    payload_kind:
      typeof node["payload_kind"] === "string"
        ? (node["payload_kind"] as StreamChunk["payload_kind"])
        : undefined,
    metadata: node["metadata"],
  };
}
```

- [ ] **Step 3: Wire `StreamRegistry` and all three transports in `apps/farmhand/src/index.ts`**

Add imports at the top of the file (after existing imports):

```typescript
import { StreamRegistry } from "./stream-registry.js";
import { toStreamChunk } from "./stream-chunk-mapper.js";
import { FileStreamTransport } from "@refarm.dev/file-stream-transport";
import { SseStreamTransport } from "@refarm.dev/sse-stream-transport";
import { WsStreamTransport } from "@refarm.dev/ws-stream-transport";
```

In `main()`, after `await httpSidecar.start()` and before the presence node write, add:

```typescript
// Stream transport layer
const streamsDir = path.join(farmhandBaseDir, "streams");
const fileStreamTransport = new FileStreamTransport(streamsDir);
const sseStreamTransport = new SseStreamTransport(fileStreamTransport);
const wsStreamTransport = new WsStreamTransport(httpSidecar.httpServer, fileStreamTransport);

httpSidecar.addRouteHandler(sseStreamTransport.getRouteHandler());

const streamRegistry = new StreamRegistry();
streamRegistry.register(fileStreamTransport);
streamRegistry.register(sseStreamTransport);
streamRegistry.register(wsStreamTransport);

tractor.onNode("StreamChunk", (node) => {
  streamRegistry.dispatch(toStreamChunk(node as Record<string, unknown>));
});

console.log("[farmhand] Stream transports registered (File, SSE, WebSocket).");
```

- [ ] **Step 4: Run Farmhand type-check**

```bash
cd apps/farmhand && npm run type-check
```

Expected: no TypeScript errors.

- [ ] **Step 5: Run all Farmhand tests**

```bash
cd apps/farmhand && npx vitest run
```

Expected: all existing tests + `stream-registry.test.ts` pass.

- [ ] **Step 6: Commit**

```bash
git add apps/farmhand/src/stream-chunk-mapper.ts apps/farmhand/src/index.ts apps/farmhand/package.json
git commit -m "feat(stream): wire StreamRegistry, three transports, and tractor.onNode(StreamChunk) in Farmhand"
```

---

## Task 7: Smoke gate — streaming round-trip

**Files:**
- Modify: `scripts/ci/smoke-task-execution-loop.mjs`
- Modify: `specs/features/stream-contract-v1.md`

The smoke gate verifies that after a `pi-agent respond` effort completes, the File stream transport has written `StreamChunk` NDJSON files containing the response tokens.

- [ ] **Step 1: Locate the pi-agent section in `scripts/ci/smoke-task-execution-loop.mjs`**

Find the comment block or section that handles pi-agent scenarios. The smoke loop runs Farmhand in a temp home, submits efforts via `refarm task run`, then checks results.

- [ ] **Step 2: Add the streaming smoke scenario**

After the existing pi-agent `respond` scenario (or after the last scenario if no pi-agent scenario exists yet), add:

```javascript
// ── Scenario: pi-agent respond emits StreamChunk NDJSON ─────────────────
console.log("[task-smoke] scenario: pi-agent streaming round-trip...");

const streamEffortId = `stream-smoke-${Date.now()}`;
const streamRunOutput = await runSubprocess(
  "node",
  [
    "--experimental-strip-types",
    "apps/refarm/src/index.ts",
    "task", "run", "pi-agent", "respond",
    "--args", JSON.stringify({ prompt: "ping" }),
    "--direction", "stream-smoke",
    "--json",
  ],
  { env, cwd: process.cwd() },
);
const streamResult = parseJsonOutput(streamRunOutput.stdout);
const streamRef = streamResult.stream_ref ?? streamResult.effortId;

// Wait for effort to complete
let streamStatus = null;
for (let attempt = 0; attempt < 20; attempt++) {
  await sleep(500);
  const statusOut = await runSubprocess(
    "node",
    [
      "--experimental-strip-types",
      "apps/refarm/src/index.ts",
      "task", "status", streamResult.effortId, "--json",
    ],
    { env, cwd: process.cwd() },
  );
  streamStatus = parseJsonOutput(statusOut.stdout);
  if (TERMINAL_STATUSES.has(streamStatus?.status)) break;
}

if (streamStatus?.status !== "done") {
  throw new Error(`[task-smoke] streaming effort did not complete: ${JSON.stringify(streamStatus)}`);
}

// Verify NDJSON file exists with at least one StreamChunk
const ndjsonPath = path.join(tempHome, ".refarm", "streams", `${streamRef}.ndjson`);
if (!fs.existsSync(ndjsonPath)) {
  throw new Error(`[task-smoke] expected NDJSON at ${ndjsonPath} but it does not exist`);
}
const lines = fs.readFileSync(ndjsonPath, "utf-8").split("\n").filter(Boolean);
if (lines.length === 0) {
  throw new Error("[task-smoke] NDJSON file is empty — no StreamChunks written");
}
const firstChunk = JSON.parse(lines[0]);
if (!firstChunk.stream_ref || typeof firstChunk.content !== "string") {
  throw new Error(`[task-smoke] first NDJSON line is not a valid StreamChunk: ${lines[0]}`);
}

console.log(`[task-smoke] ✅ streaming round-trip: ${lines.length} chunk(s) in ${ndjsonPath}`);
```

Also add `import fs from "node:fs";` at the top of the file if it is not already present.

- [ ] **Step 3: Run the smoke gate locally**

```bash
node scripts/ci/smoke-task-execution-loop.mjs
```

Expected: all scenarios pass including the new streaming scenario. If pi-agent is not installed in `~/.refarm/plugins/`, the scenario will be skipped or fail gracefully — the gate must not hard-fail on a missing plugin.

- [ ] **Step 4: Update `specs/features/stream-contract-v1.md`**

Change `**Status**: Draft` → `**Status**: In Progress`

Mark all TDD and DDD implementation tasks as `[x]`.

- [ ] **Step 5: Commit**

```bash
git add scripts/ci/smoke-task-execution-loop.mjs specs/features/stream-contract-v1.md
git commit -m "test(stream): add streaming smoke gate scenario and mark spec In Progress"
```
