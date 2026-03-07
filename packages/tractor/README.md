# 🌱 Refarm Tractor

> The pure isomorphic microkernel and sovereign orchestrator of Refarm.

---

## What Is This?

Tractor is Refarm's core SDK and orchestration engine. It follows a strict **Microkernel architecture**: it provides the mechanisms but delegates all domain-specific logic (Storage, Identity, Sync) to **Adapters/Plugins**.

- 🔌 **Plugin Orchestrator**: Hosts WASM components via WIT boundary.
- 💾 **Abstract Storage**: Delegates persistence to versioned contracts.
- 🔐 **Contract-First**: Depends only on `@refarm.dev/*-contract-v1`.
- 🎯 **Data Normalization**: Validates and transforms → JSON-LD (Sovereign Graph).
- 🌍 **Isomorphic**: Runs identically in Browser, Node.js, and Edge environments.

---

## Quick Start (5 min)

### 1. Install Dependencies

```bash
cd refarm  # Root of monorepo
npm install
```

### 2. Start Kernel in Dev Mode

```bash
npm run dev       # Starts all apps (kernel + studio)
```

Kernel runs on **<http://localhost:3000>** (Node.js + TypeScript via tsx)

### 3. Test Tractor Directly

```bash
# Run stress tests (18 tests including concurrent boot/plugin floods)
cd packages/tractor
npx vitest run test/stress.test.ts

# Run benchmarks
npm run bench
```

### 4. Verify Installation

```bash
npm run build -- -F @refarm/kernel

# Should output:
# ✅ @refarm/kernel built successfully
```

---

## Project Structure

```
packages/tractor/
├── src/
│   ├── index.ts              # Main Tractor class
│   ├── core/
│   │   ├── plugin-host.ts    # WASM plugin sandbox
│   │   └── normalizer.ts     # JSON-LD Sovereign Graph transform
│   └── ...
├── test/
│   ├── stress.test.ts        # Robustness suite
│   └── stress.bench.ts       # Performance baselines
├── benchmarks/
│   └── baseline.json         # Sanitized performance snapshot
├── package.json
└── tsconfig.json
```

---

## Core API (Preview)

### Initialize Kernel

```typescript
import { Tractor } from '@refarm/tractor';

const tractor = await Tractor.boot({
  storage: storageAdapter,   // Implements StorageAdapter v1
  identity: identityAdapter, // Implements IdentityAdapter v1
  sync: syncAdapter          // Optional
});
```

### Create Session

```typescript
// Guest session (no identity, vaultId only)
const guest = await kernel.createGuestSession({
  storageTier: 'persistent'  // or 'ephemeral', 'synced'
});

// Permanent session (Nostr identity)
const permanent = await kernel.createPermanentSession();
```

### Store & Query Data

```typescript
// Store a node (JSON-LD)
const nodeId = await kernel.storeNode(guest.vaultId, {
  '@type': 'Note',
  'title': 'My Note',
  'content': 'Hello world'
});

// Query nodes
const notes = await kernel.queryNodes(guest.vaultId, 'Note', { limit: 10 });
```

### Load Plugin

```typescript
// Load from manifest (Standardized metadata)
const plugin = await tractor.loadPlugin(manifest);

// Tractor verifies SHA-256 before instantiation
```

---

## Development Workflow

### Phase 1: Unit Tests (Red)

```bash
npm run test:unit -- apps/kernel

# All tests should FAIL initially (red phase)
```

### Phase 2: Integration Tests (Red)

```bash
npm run test:integration -- apps/kernel

# Multi-module scenarios should FAIL
```

### Phase 3: TDD Implementation

```bash
# Make tests pass
npm run test:watch -- apps/kernel

# Watch mode auto-reruns on file changes
```

### Phase 4: E2E Validation

Once unit + integration tests pass:

```bash
npm run test:e2e -- apps/kernel

# Full browser workflows in Playwright
```

---

## Key Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `@refarm/storage-sqlite` | Persistence layer | workspace:* |
| `@refarm/sync-crdt` | CRDT sync engine | workspace:* |
| `@refarm/identity-nostr` | Identity + signing | workspace:* |
| `typescript` | Type safety | ^5.3 |

---

## Testing Strategy

See [ADR-013: Testing Strategy](../../specs/ADRs/ADR-013-testing-strategy.md) for detailed test organization.

**Quick reference**:

```bash
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run test             # All tests (unit + integration)
npm run test:watch       # Watch mode
```

**Coverage goal**: >80% lines, >70% branches

---

## Storage Layer

The Kernel delegates persistence to `@refarm/storage-sqlite`. See its README for:

- OPFS quota management
- SQLite schema design
- Transaction + WAL mode

---

## Plugin System

Plugins communicate via **WIT interface** defined in [`wit/refarm-sdk.wit`](../../wit/refarm-sdk.wit).

**Security model**:

1. Plugin runs in WASM sandbox (no DOM access)
2. All calls through WIT boundary are capability-gated
3. User grants permissions (storage read/write, network)
4. Kernel enforces at runtime

**Example plugin**:

```typescript
// Plugin exports "integration" world
export async function ingest(payload: Uint8Array): Result<u32> {
  // Plugin can call:
  //   kernel.storeNode(node)
  //   kernel.queryNodes(type, limit)
  //   kernel.requestPermission(capability)
  return Ok(1000);  // Returned count
}
```

---

## Common Tasks

### Add a New Core Module

1. Create `src/new-module/index.ts`
2. Add unit tests in `src/new-module/index.test.ts`
3. Integration tests in `src/core.integration.test.ts`
4. Update `src/index.ts` exports

### Debug Plugin Execution

```bash
# Run Kernel with debug logging
DEBUG=refarm:* npm run dev

# Watch WASM calls
DEBUG=refarm:plugin-host:* npm run dev
```

### Profile Performance

```bash
npm run perf -- apps/kernel

# Outputs:
# - Kernel startup time
# - Plugin load time
# - Query latency (100k nodes)
```

---

## Troubleshooting

### "Module not found: @refarm/storage-sqlite"

```bash
# Rebuild workspace
npm run build -- -F @refarm/storage-sqlite
npm run dev
```

### "WASM instantiation failed"

- Ensure WASM plugin is signed correctly
- Check plugin hash matches manifest
- Verify WIT interface compatibility

### "Storage quota exceeded"

- Check OPFS quota (usually 10-50GB on desktop)
- Run `npm run test -- --name="quota"` to stress test

---

## Next Steps

- 📖 [Architecture](../../docs/ARCHITECTURE.md)
- 🗺️ [Technical Roadmap](./ROADMAP.md)
- 📋 [Testing Strategy](../../specs/ADRs/ADR-013-testing-strategy.md)
- 🔌 [Plugin Developer Guide](../../docs/PLUGIN_DEVELOPER_PLAYBOOK.md)

---

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for:

- Git workflow (feature branches, changesets)
- Code style (TypeScript strict mode)
- PR review process (SDD → BDD → TDD → DDD)

---

## License

[MIT](../../LICENSE)
