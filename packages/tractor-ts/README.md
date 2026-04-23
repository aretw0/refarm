# 🌱 Refarm Tractor

> The pure isomorphic microkernel and sovereign orchestrator of Refarm.

---

## What Is This?

Tractor is Refarm's core SDK and orchestration engine. It follows a strict **Microkernel architecture**: it provides the raw data mechanisms but explicitly delegates all presentation, orchestration, and domain-specific logic to **Host Providers** or **Plugins**.

- 🔌 **Plugin Orchestrator**: Hosts WASM components via WIT boundary.
- 💾 **Abstract Storage**: Delegates persistence to versioned contracts.
- 💡 **Headless Kernel**: UI logic (Vault Secrets, Localization, Account Recovery) is strictly decoupled into independent `Host` classes.
- 🎯 **Data Normalization**: Validates and transforms → JSON-LD (Sovereign Graph).
- 🌍 **Isomorphic**: Runs identically in Browser, Node.js, and Edge environments.

---

## Quick Start (5 min)

### 1. Install Dependencies

```bash
cd refarm  # Root of monorepo
npm install
```

### 2. Start Tractor in Dev Mode

```bash
npm run dev       # Starts all apps (kernel + studio)
```

Tractor runs on **<http://localhost:3000>** (Node.js + TypeScript via tsx)

### 3. Test Tractor Directly

```bash
# Run stress tests (18 tests including concurrent boot/plugin floods)
cd packages/tractor
npx vitest run test/stress.test.ts

# Run real WASM instantiation integration (validates JCO runtime)
npx vitest run test/real-instantiation.integration.test.ts

# Run benchmarks
npm run bench
```

### 4. Verify Installation

```bash
npm run build -- -F @refarm.dev/kernel

# Should output:
# ✅ @refarm.dev/kernel built successfully
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

### Initialize Tractor

```typescript
import { Tractor } from '@refarm.dev/tractor';

const tractor = await Tractor.boot({
  storage: storageAdapter,   // Implements StorageAdapter v1
  identity: identityAdapter, // Implements IdentityAdapter v1
  sync: syncAdapter          // Optional
});
```

### Create Session (Injected via Identity Adapter)

Tractor handles session logic by delegating to the injected **Identity Adapter**.

```typescript
// Identity logic is now handled by the adapter implementation
const identity = new MyIdentityAdapter();
const session = await identity.getSession();
```

### Store & Query Data

```typescript
// Store a node (JSON-LD)
const nodeId = await tractor.storeNode(guest.vaultId, {
  '@type': 'Note',
  'title': 'My Note',
  'content': 'Hello world'
});

// Query nodes
const notes = await tractor.queryNodes(guest.vaultId, 'Note', { limit: 10 });
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
npm run test:e2e -- packages/tractor
```

---

## Key Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `@refarm.dev/storage-contract-v1` | Persistence Interface | workspace:* |
| `@refarm.dev/sync-contract-v1` | Sync Interface | workspace:* |
| `@refarm.dev/identity-contract-v1` | Identity Interface | workspace:* |
| `@refarm.dev/plugin-manifest` | Manifest Schema | workspace:* |

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

Tractor delegates persistence to any implementation of `@refarm.dev/storage-contract-v1`. While `@refarm.dev/storage-sqlite` is the default reference implementation, any adapter that fulfills the contract (e.g., PostgreSQL, IndexedDB) can be used.

The contract defines:
- The required **Sovereign Graph** table schema.
- Conformance tests to ensure consistent behavior across runtimes.

---

## Plugin System

Plugins communicate via **WIT interface** defined in [`wit/refarm-sdk.wit`](../../wit/refarm-sdk.wit).

**Runtime**:

- **Node.js**: Tractor uses [`jco`](https://github.com/bytecodealliance/jco) to transpile WASM components into JavaScript modules at load time.
- **Browser**: Tractor loads cache-backed artifacts from OPFS.
  - `artifactKind=module` executes via `WebAssembly.instantiate`
  - `artifactKind=component` executes via integrity-verified ESM sidecar (`browserRuntimeModule`) linked by descriptor metadata.

**Security model**:

1. Plugin runs in WASM sandbox (no DOM access)
2. All calls through WIT boundary are capability-gated
3. User grants permissions (storage read/write, network)
4. Tractor enforces at runtime

**Example plugin**:

```typescript
// Plugin exports "integration" world
export async function ingest(payload: Uint8Array): Result<u32> {
  // Plugin can call host functions defined in WIT:
  //   tractor.storeNode(node)
  //   tractor.queryNodes(type, limit)
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
# Run Tractor with debug logging
DEBUG=refarm:* npm run dev

# Watch WASM calls
DEBUG=refarm:plugin-host:* npm run dev
```

### Generate browser runtime descriptor for component sidecars

```bash
npm run runtime-module:descriptor -- \
  --plugin-id @acme/component-plugin \
  --component-url https://cdn.example/component.wasm \
  --module-file ./dist/component.browser.mjs \
  --module-url https://cdn.example/component.browser.mjs \
  --out ./dist/component.runtime-descriptor.json
```

This emits a deterministic descriptor with `descriptorIntegrity` so install-time flows can verify sidecar provenance.

For CI/local gate validation:

```bash
npm run runtime-module:ci
```

This runs deterministic smoke generation + descriptor verification (`runtime-module:smoke`).

### Profile Performance

```bash
npm run bench:check
```

> **Local Baselines**: Refarm uses Git hooks to prompt you to generate a `benchmarks/baseline.json` when switching branches. This file represents your performance floor. If you optimize or refactor code, run `npm run bench:save` to update your local baseline snapshot, then use `npm run bench:check` to compare your current work against it.

### Observability & Diagnostics

Refarm Tractor uses a "Black Box Recorder" pattern designed to give diagnostics without compromising data privacy or degrading console performance.

- You can export the in-memory **Telemetry Ring Buffer** to a sanitized JSON document using `system:diagnostics:export`.
- Sensitive fields like `secretKey` or `token` are masked automatically (`[REDACTED]`).
- Massive payloads and strings are elegantly truncated.
- **For a detailed architecture, read [docs/OBSERVABILITY.md](./docs/OBSERVABILITY.md)**.

---

## Troubleshooting

### "Module not found: @refarm.dev/storage-contract-v1"

```bash
# Rebuild workspace to generate declarations
npm run build
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
