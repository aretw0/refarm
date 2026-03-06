# ADR-013: Testing Strategy (Vitest + Playwright + Changesets)

**Status**: Accepted  
**Date**: 2026-03-06  
**Decision Drivers**:

- ESM-first monorepo (Turborepo + npm workspaces)
- SDD → BDD → TDD → DDD workflow
- Multi-package architecture (kernel, storage, sync, identity)
- Progressive Web App requirements (browser + service workers + OPFS)

---

## Decision

We adopt a **three-tier testing strategy**:

| Tier | Tool | Scope | When |
|------|------|-------|------|
| **Unit** | Vitest | Pure functions, class methods, contracts | TDD phase |
| **Integration** | Vitest + JSDOM/Node | Multi-module interactions, storage APIs | BDD phase |
| **E2E** | Playwright | Full user workflows, persistence, P2P sync | DDD validation |

---

## Rationale

### Why Vitest (not Jest)?

| Aspect | Vitest | Jest |
|--------|--------|------|
| ESM Support | ✅ Native | ⚠️ Via workarounds |
| Speed | 🚀 ~500ms cold start | 🐢 ~2000ms |
| Config | Shares `vite.config.ts` | Separate `jest.config.js` |
| Browser APIs | JSDOM + VM modules | JSDOM only |
| Monorepo | Excellent (workspace-aware) | Good |

**Decision**: Vitest is **faster**, **ESM-native**, and **shares config** with build tooling.

### Why Playwright (not Cypress)?

| Aspect | Playwright | Cypress |
|--------|-----------|--------|
| Browsers | Chrome, Firefox, Safari, Edge | Chrome + Electron |
| Service Workers | ✅ Full support | ❌ Limited |
| OPFS | ✅ Can interact via CDP | ❌ No direct access |
| WebRTC | ✅ Full support | ⚠️ Partial |
| Multi-tab | ✅ Native | ❌ Via workarounds |
| Speed | 🚀 Parallel execution | 🐢 Serial by default |

**Decision**: Playwright is essential for **PWA testing** (Service Workers, OPFS, P2P sync between tabs).

### Why Changesets (not manual versioning)?

- ✅ **Atomic**: Each PR includes version bump + changelog
- ✅ **Monorepo-aware**: Versions packages independently
- ✅ **Review-ready**: Changelog changes visible in PR diff
- ✅ **Scripted**: `npm run changeset:version` + `npm run changeset:publish`

---

## Implementation

### Package Structure

```
refarm/
├── package.json
│   ├── "devDependencies": {
│   │   "vitest": "^1.x",
│   │   "playwright": "^1.x",
│   │   "@changesets/cli": "^2.x"
│   │ }
│
├── vitest.config.ts (shared root config)
│   ├── browser: "jsdom" (for unit/integration)
│   ├── globals: true
│   └── coverage: { thresholds: { lines: 80, branches: 70 } }
│
├── playwright.config.ts
│   ├── webServer: { command: "npm run dev", port: 3000 }
│   ├── use: { browsers: ["chromium", "firefox", "webkit"] }
│   └── timeout: 30000
│
├── .github/workflows/test.yml (CI pipeline)
│
└── .changeset/
    ├── config.json
    └── *.md (one per PR)
```

### Test Organization by Package

#### `apps/kernel`

```
apps/kernel/
├── src/
│   ├── index.ts
│   ├── core/
│   │   ├── session.ts
│   │   └── session.test.ts (unit)
│   ├── plugin-host/
│   │   ├── host.ts
│   │   └── host.test.ts (unit)
│   └── integration.test.ts (BDD)
│
└── e2e/
    ├── guest-workflow.test.ts
    ├── guest-upgrade.test.ts
    └── plugin-loading.test.ts (Playwright)
```

#### `packages/storage-sqlite`

```
packages/storage-sqlite/
├── src/
│   ├── adapters/
│   │   ├── opfs.ts
│   │   └── opfs.test.ts
│   ├── schema/
│   │   ├── schema.ts
│   │   └── schema.test.ts
│   └── storage.test.ts (integration)
│
└── e2e/
    ├── persistence.test.ts (Playwright: OPFS quota, restart)
    └── migration.test.ts (guest → permanent ownership rewrite)
```

#### `packages/sync-crdt`

```
packages/sync-crdt/
├── src/
│   ├── crdt/
│   │   ├── yjs-wrapper.ts
│   │   └── yjs-wrapper.test.ts
│   ├── sync-engine.ts
│   ├── sync-engine.test.ts (unit)
│   └── integration.test.ts (multi-client)
│
└── e2e/
    ├── two-device-sync.test.ts (Playwright: 2 browser tabs + WebRTC)
    └── conflict-resolution.test.ts
```

### Test Phases (Aligned with SDD → BDD → TDD → DDD)

#### **Phase 1: SDD** ✅

- Create ADRs and specs
- No tests yet (or minimal fixtures)

#### **Phase 2: BDD** 🔴 Tests FAIL

```bash
npm run test:integration -- packages/storage-sqlite

FAIL: "When guest stores data, should persist after reload"
  Expected: data in OPFS
  Actual: data gone (not implemented yet)
```

#### **Phase 3: TDD** 🔴 Unit tests FAIL

```bash
npm run test:unit -- packages/storage-sqlite

FAIL: "opfs adapter should create vault directory"
  Expected: directory exists
  Actual: adapter not implemented yet
```

#### **Phase 4: DDD** 🟢 All tests PASS

```bash
npm run test         # All tests pass ✅
npm run test:e2e     # E2E flows work ✅
npm run lint         # Code clean ✅
```

---

## Quality Gates

### Unit Test Gate (>80% coverage)

```bash
npm run test:unit -- --coverage

# Must report:
# ✅ Lines: >80%
# ✅ Branches: >70%
# ✅ Functions: >80%
```

Key areas to cover:

- ✅ Storage CRUD, error handling
- ✅ CRDT merge conflicts
- ✅ Guest session creation + upgrade
- ✅ JSON-LD validation
- ✅ Network adapter switching

### Integration Test Gate (BDD acceptance)

```bash
npm run test:integration

# All scenarios must PASS:
# ✅ Guest joins board without account
# ✅ Data persists in OPFS after reload
# ✅ Guest data syncs between 2 clients
# ✅ Guest upgrades to permanent identity
```

### E2E Test Gate (Full workflows)

```bash
npm run test:e2e -- --headed  # See browser

# All sequences must PASS:
# ✅ New user → guest → permanent flow
# ✅ Multi-tab sync via Yjs + WebRTC
# ✅ OPFS quota alerts
# ✅ Storage tier switching
```

---

## CI/CD Integration

### GitHub Actions Workflow (`.github/workflows/test.yml`)

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Lint
        run: npm run lint
      
      - name: Unit tests
        run: npm run test:unit -- --coverage
      
      - name: Integration tests
        run: npm run test:integration
      
      - name: E2E tests
        run: npm run test:e2e
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

---

## npm Scripts (Root `package.json`)

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run --workspace='./packages/*/vites.config.ts' --workspace='./apps/*/vitest.config.ts'",
    "test:integration": "vitest run --include='**/*.integration.test.ts'",
    "test:watch": "vitest --watch",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "coverage": "vitest run --coverage",
    "changeset": "changeset",
    "changeset:version": "changeset version",
    "changeset:publish": "changeset publish"
  }
}
```

---

## Changeset Workflow

### 1. After Making Changes

```bash
npm run changeset
```

Prompts:

```
Which packages changed? [select] @refarm/storage-sqlite
Version bump type? [major/minor/patch] minor
Describe: "Add OPFS adapter with quota management"

# Creates: .changeset/{uuid}.md
```

### 2. PR Review

Reviewer sees in PR diff:

```markdown
# .changeset/brave-pandas.md

- @refarm/storage-sqlite@minor: Add OPFS adapter with quota management
```

### 3. Release (Maintainer)

```bash
npm run changeset:version  # Bumps versions + updates CHANGELOG.md
npm run build
npm run changeset:publish  # Publishes to npm
git push
```

---

## Success Criteria

| Metric | Target | Validation |
|--------|--------|-----------|
| Unit coverage | >80% | `npm run coverage` |
| BDD pass rate | 100% | `npm run test:integration` |
| E2E pass rate | 100% | `npm run test:e2e` |
| CI latency | <5min | GitHub Actions logs |
| Release cycle | 1-2 weeks | Changelog frequency |

---

## Implementation Status

**Status**: ✅ Setup Complete  
**Date**: 2026-03-06

### What's Done

- [x] **Root config**: `vitest.config.ts` (shared JSDOM, coverage gates, workspace-aware)
- [x] **Dependencies**: Vitest + @vitest/ui added to root `package.json`
- [x] **Root scripts**: Updated to call `vitest` directly for unit/integration, `turbo run test:e2e` for E2E
- [x] **Workspace scripts**: All packages + apps using `test:unit: "vitest run"` instead of Jest
- [x] **Turbo tasks**: `turbo run test:unit` orchestrates parallel test execution across packages

### How to Run

```bash
# Unit + integration (Vitest)
npm run test:unit
npm run test:integration

# E2E (Playwright - runs via turbo)
npm run test:e2e

# With UI
npm run test:watch
npm run test:e2e:ui

# Coverage report
npm run coverage
```

### Next Steps

When implementing tests for each package:
1. Create `src/**/*.test.ts` files alongside source code
2. Vitest will auto-discover and run them
3. Ensure JSDOM env is appropriate (override in `vitest.config.ts` per workspace if needed for Node-heavy tests)

### Known Gotcha (Vitest v2)

- Coverage thresholds must be nested under `coverage.thresholds`.
- Using `coverage.lines`, `coverage.branches`, etc. directly triggers TypeScript error in `vitest/config` typings.

Example:

```ts
coverage: {
  provider: 'v8',
  thresholds: {
    lines: 80,
    branches: 70,
    functions: 80,
    statements: 80,
  },
}
```

---

## References

- [Vitest Documentation](https://vitest.dev)
- [Playwright Documentation](https://playwright.dev)
- [Changesets Documentation](https://github.com/changesets/changesets)
- [ADR-002: Offline-First Architecture](./ADR-002-offline-first-architecture.md) — Testing strategy for Storage → Sync → Network

---

## Appendix: Example Test File

### `apps/kernel/src/core/session.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kernel } from '../index';
import { Session } from './session';

describe('Session (Unit)', () => {
  let kernel: Kernel;

  beforeEach(async () => {
    kernel = new Kernel({ storage: 'memory' }); // Test mode
  });

  afterEach(async () => {
    await kernel.shutdown();
  });

  describe('Guest Session', () => {
    it('should create guest with UUID vaultId', async () => {
      const session = await kernel.createGuestSession('persistent');
      expect(session.identity.type).toBe('guest');
      expect(session.identity.vaultId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('should store chosenStorageTier', async () => {
      const session = await kernel.createGuestSession('persistent');
      expect(session.storageTier).toBe('persistent');
    });
  });

  describe('Permanent Session', () => {
    it('should create permanent with BIP-39 mnemonic', async () => {
      const session = await kernel.createPermanentSession();
      expect(session.identity.type).toBe('permanent');
      expect(session.identity.mnemonic).toMatch(/^(\w+ ){23}\w+$/);
    });

    it('should upgrade guest to permanent (rewrite ownership)', async () => {
      const guest = await kernel.createGuestSession('persistent');
      const nodeId = await kernel.storeNode(guest.vaultId, { title: 'Test' });

      const upgraded = await guest.upgradeToPermament();
      const node = await kernel.getNode(upgraded.identity.pubkey, nodeId);
      expect(node.owner).toBe(upgraded.identity.pubkey);
    });
  });
});
```
