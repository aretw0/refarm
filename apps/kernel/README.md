# 🌱 Refarm Kernel

> The sovereign brain of Refarm—where plugins talk to storage, queries execute, and data lives offline.

---

## What Is This?

The **Kernel** is Refarm's orchestration engine. It:

- 🔌 Hosts plugins (WASM components via WIT boundary)
- 💾 Manages storage (SQLite in OPFS + Sync via CRDT)
- 🔐 Enforces security (capability-based, guest vs. permanent identity)
- 📡 Routes network calls (Network abstraction layer)
- 🎯 Normalizes data (→ JSON-LD before persistence)

Think of it as the OS kernel for your personal data.

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

### 3. Test Kernel Directly

```bash
npm run test:unit -- packages/kernel

# Or watch mode
npm run test:watch -- packages/kernel
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
apps/kernel/
├── src/
│   ├── index.ts              # Main Kernel class
│   ├── core/
│   │   ├── session.ts        # Guest/Permanent session lifecycle
│   │   ├── plugin-host.ts    # WASM plugin sandbox
│   │   └── normalizer.ts     # JSON-LD validation
│   ├── storage/
│   │   ├── adapter.ts        # Unified storage interface
│   │   └── migrations.ts     # Schema upgrades
│   ├── sync/
│   │   ├── engine.ts         # CRDT reconciliation
│   │   └── providers.ts      # Transport adapters (WebRTC, relay)
│   └── network/
│       ├── abstraction.ts    # Network trait/interface
│       └── adapters/         # HTTP, Matrix, Nostr
├── package.json
├── tsconfig.json
└── README.md (this file)
```

---

## Core API (Preview)

### Initialize Kernel

```typescript
import { Kernel } from '@refarm/kernel';

const kernel = new Kernel({
  storage: 'opfs',           // or 'memory' for testing
  plugins: ['auto-discover'], // or specific plugin URLs
  network: 'local-first'
});

await kernel.initialize();
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
// Fetch WASM plugin from URL
const plugin = await kernel.loadPlugin({
  url: 'https://example.com/plugin.wasm',
  hash: 'sha256:...'  // Verified
});

// Plugin can now call kernel-bridge functions
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
