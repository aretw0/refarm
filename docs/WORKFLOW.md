# Development Workflow: SDD → BDD → TDD → DDD

**Purpose**: Prevent implementation chaos through disciplined, spec-driven quality gates.  
**Philosophy**: Specifications first, tests second, implementation last.  
**Result**: Measurable progress, guaranteed quality, maintainable codebase.

---

## Visual Overview

![Development Lifecycle](./diagrams/workflow-diagram.svg)
[View source](file:///workspaces/refarm/docs/diagrams/workflow-diagram.mermaid)

**Key Principle**: Tests fail FIRST (red), then code makes them pass (green).

**Detailed Flow**:

![SDD to DDD Workflow](./diagrams/workflow-diagram.svg)

**Diagram Source of Truth**: [`docs/diagrams/workflow-diagram.mermaid`](file:///workspaces/refarm/docs/diagrams/workflow-diagram.mermaid)

To regenerate this diagram after editing the source:

```bash
npm run diagrams:fix
```

This will regenerate all `.svg` files from their corresponding `.mermaid` sources. See [CONTRIBUTING.md#diagrams](../CONTRIBUTING.md#diagrams) for details.

---

## Why This Workflow?

### The Problem

Software projects tend toward **implementation chaos**:

- Features built without clear requirements
- Tests written as afterthoughts (or not at all)
- Technical debt accumulates silently
- Regressions sneak in unnoticed
- Architecture drifts from original intent

### The Solution

Force structured gates at every milestone:

1. **SDD** — Define what we're building (specifications + decisions)
2. **BDD** — Define expected behavior (integration tests that FAIL)
3. **TDD** — Define contracts (unit tests that FAIL)
4. **DDD** — Implement until tests PASS

**Gate**: Cannot proceed to next phase until previous phase is complete and peer-reviewed.

---

## The Four Phases

### Phase 1: SDD (Specification Driven Development)

**Goal**: Document architectural decisions and component contracts BEFORE writing tests or code.

**Sovereign Interoperability Gates**:
- **WASM Components**: Define capabilities in WIT (Wasm Interface Type).
- **Sovereign Graph**: Define JSON-LD structures for semantic data portability.
- **Contract Interface**: Define the TypeScript interface and conforming capability (e.g., `storage:v1`).

**Artifacts**:
- **ADRs** (Architecture Decision Records) — Major technical choices
- **Specs** — Component interfaces, data schemas, API contracts
- **Diagrams** — Data flow, sequence diagrams, architecture overviews

**Deliverables**:

```
specs/
├── ADRs/
│   └── ADR-001-monorepo-structure.md
├── features/
│   └── storage-interface.md
└── diagrams/
    └── data-flow.mermaid
```

**Quality Gate**:

- [ ] All architectural questions answered
- [ ] Public interfaces documented
- [ ] Data schemas defined (JSON-LD, WIT, TypeScript types)
- [ ] At least 1 peer review on each ADR/spec
- [ ] No "TODO" or "TBD" in critical sections

**When to Skip**: Never. Every milestone starts with SDD.

---

### Phase 2: BDD (Behavior Driven Development)

**Goal**: Define expected behavior via integration tests and conformance suites before implementation.

**Core Mechanics**:
- **Conformance Suites**: Use `run[Contract]Conformance()` helpers to validate interface compliance.
- **Integration Specs**: Describe user scenarios (e.g., `vitest` unit tests acting as behavior specs).

**Characteristic**: Tests MUST FAIL initially (red phase).

**Artifacts**:

- Integration test suites (e2e, component integration)
- Acceptance criteria as executable tests
- User scenario tests

**Example**:

```typescript
// tests/integration/storage.spec.ts

describe("Offline-first storage", () => {
  it("persists data when offline", async () => {
    const storage = await createStorage({ offline: true });
    
    await storage.set("key", { value: "data" });
    
    // Simulate app restart
    await storage.close();
    const newStorage = await createStorage({ offline: true });
    
    const result = await newStorage.get("key");
    expect(result).toEqual({ value: "data" });
  });
  
  it("syncs data between 2 clients", async () => {
    const client1 = await createClient();
    const client2 = await createClient();
    
    await client1.set("key", "value1");
    await waitForSync();
    
    const result = await client2.get("key");
    expect(result).toBe("value1");
  });
});
```

**Quality Gate**:

- [ ] All user-facing behaviors have tests
- [ ] Tests are readable (describe user scenarios, not implementation)
- [ ] Tests FAIL (red) because implementation doesn't exist yet
- [ ] Coverage target defined (e.g., "all happy paths + 3 error cases")
- [ ] Peer reviewed for completeness

**When to Skip**:

- Small utility functions (use TDD only)
- Internal refactors that don't change behavior
- Documentation-only changes

---

### Phase 3: TDD (Test Driven Development)

**Goal**: Write unit tests that define **contracts** for individual functions/classes.

**Characteristic**: Tests MUST FAIL initially (red phase).

**Artifacts**:

- Unit test suites
- Contract tests (interfaces, types)
- Edge case coverage

**Example**:

```typescript
// packages/storage-sqlite/src/crud.test.ts

describe("CRUD operations", () => {
  let db: Database;
  
  beforeEach(() => {
    db = createInMemoryDB();
  });
  
  describe("insert", () => {
    it("returns inserted ID", async () => {
      const id = await db.insert("users", { name: "Alice" });
      expect(id).toBeGreaterThan(0);
    });
    
    it("throws on duplicate primary key", async () => {
      await db.insert("users", { id: 1, name: "Alice" });
      await expect(
        db.insert("users", { id: 1, name: "Bob" })
      ).rejects.toThrow("UNIQUE constraint failed");
    });
  });
  
  describe("CRDT merge", () => {
    it("resolves conflicts with LWW", () => {
      const state1 = { value: "A", timestamp: 100 };
      const state2 = { value: "B", timestamp: 200 };
      
      const result = merge(state1, state2);
      
      expect(result.value).toBe("B"); // Last-Write-Wins
      expect(result.timestamp).toBe(200);
    });
  });
});
```

**Quality Gate**:

- [ ] All public functions have unit tests
- [ ] Edge cases covered (null, empty, boundary conditions)
- [ ] Tests FAIL (red) because implementation is stub/missing
- [ ] Coverage ≥80% for core logic
- [ ] Fast execution (<1s for entire unit suite)

**When to Skip**:

- Pure integration components (web servers, routers)
- Thin wrappers around third-party libraries
- UI components (use BDD with component tests instead)

---

### Phase 4: DDD (Domain Driven Design & Implementation)

**Goal**: Write the minimal code necessary to make ALL tests pass while cultivating the "Solo Fértil".

**Domain Layers**:
- **Sovereign Nodes**: Map concepts (Identity, Note) to the JSON-LD graph.
- **Tractor Policies**: Orchestrate plugin interaction with user data.
- **Plugin Ingestion**: Normalize external data into sovereign formats.

**Characteristic**: Tests transition from RED → GREEN.

**Artifacts**:

- Production code
- Domain models, services, repositories
- Infrastructure adapters

**Implementation Rules**:

1. **Start with simplest failing test**
2. **Write minimal code to make it pass**
3. **Refactor only when green**
4. **Repeat until all tests pass**

**Domain Organization**:

```
packages/storage-sqlite/
├── src/
│   ├── domain/           # Core business logic
│   │   ├── storage.ts    # Storage interface (spec)
│   │   └── crud.ts       # CRUD operations
│   ├── infra/            # Infrastructure adapters
│   │   ├── sqlite-adapter.ts
│   │   └── opfs-adapter.ts
│   └── index.ts          # Public API
└── tests/
    ├── unit/
    └── integration/
```

**Quality Gate**:

- [ ] All BDD tests pass (green)
- [ ] All TDD tests pass (green)
- [ ] No skipped/pending tests
- [ ] Code coverage meets target (≥80%)
- [ ] No linting errors
- [ ] Peer reviewed (code + architecture alignment with specs)
- [ ] Changeset created (`npm run changeset`)

**When to Skip**: Never. DDD is the final step where code is written.

---

## Quality Gates Summary

| Phase | Entry Criteria | Exit Criteria | Can Skip? |
|-------|----------------|---------------|-----------|
| **SDD** | Milestone defined | ADRs + specs complete, peer reviewed | ❌ Never |
| **BDD** | SDD complete | Integration tests written (RED), peer reviewed | ⚠️ Small utilities only |
| **TDD** | BDD complete | Unit tests written (RED), peer reviewed | ⚠️ Pure integration components |
| **DDD** | TDD complete | All tests GREEN, coverage met, changeset created | ❌ Never |

---

## Example: Full Cycle for `storage-sqlite`

### 1. SDD Phase

**Deliverable**: `specs/features/storage-interface.md`

```markdown
# Storage Interface Specification

## Purpose
Provide offline-first persistence via SQLite/OPFS.

## Public API
```typescript
interface Storage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  close(): Promise<void>;
}
```

## Architecture Decision

- ADR-002: Use SQLite WASM + OPFS for browser persistence
- ADR-003: Virtual file system via sql.js VFS

```

**Gate**: ✅ Peer reviewed, no open questions.

---

### 2. BDD Phase

**Deliverable**: `packages/storage-sqlite/tests/integration/storage.spec.ts`

```typescript
describe("Storage", () => {
  it("persists data across restarts", async () => {
    const storage = await createStorage();
    await storage.set("key", "value");
    await storage.close();
    
    const newStorage = await createStorage();
    expect(await newStorage.get("key")).toBe("value");
  });
});
```

**Status**: 🔴 FAILING (storage not implemented yet)

**Gate**: ✅ Test is clear, peer reviewed.

---

### 3. TDD Phase

**Deliverable**: `packages/storage-sqlite/src/crud.test.ts`

```typescript
describe("CRUD", () => {
  it("insert returns ID", async () => {
    const id = await db.insert("table", { data: "value" });
    expect(id).toBeGreaterThan(0);
  });
});
```

**Status**: 🔴 FAILING (db.insert is a stub)

**Gate**: ✅ Contract tests complete, peer reviewed.

---

### 4. DDD Phase

**Deliverable**: `packages/storage-sqlite/src/crud.ts`

```typescript
export async function insert(
  db: Database,
  table: string,
  data: Record<string, unknown>
): Promise<number> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map(() => "?").join(",");
  
  const sql = `INSERT INTO ${table} (${keys.join(",")}) VALUES (${placeholders})`;
  const result = await db.run(sql, values);
  
  return result.lastInsertRowid;
}
```

**Status**: 🟢 PASSING (all tests green)

**Gate**: ✅ Tests pass, coverage 85%, changeset created.

---

## Workflow in Practice

### Starting a New Milestone

```bash
# 1. Start a new task using the Developer Toolbox
npm run task:start

# > Select "Feature / Issue Mode"
# > Enter GitHub Issue ID: 42
# > Linked to: "identity provider implementation"
# > Do you want to initialize an SDD Spec? (Y) -> vim specs/features/identity-provider.md
# > Does this feature require an ADR? (Y) -> vim specs/ADRs/ADR-004-identity-provider.md

# 2. Write integration tests (BDD)
vim packages/identity-nostr/tests/integration/identity.spec.ts

# 3. Verify Quality Gates (should FAIL / RED)
npm run task:verify

# 4. Write unit tests & Implement (TDD & DDD)
vim packages/identity-nostr/src/keypair.test.ts
vim packages/identity-nostr/src/keypair.ts

# 5. Verify Quality Gates (should PASS / GREEN)
npm run task:verify

# 6. Finish Task
# This automates running `task:verify`, changeset generation, commits, and pushes
npm run task:finish

# 7. Open PR
# The finish script suggests: gh pr create --title "finish: work on #42" --fill --body "Fixes #42"
```

### Comandos do Toolbox

1. `npm run task:start` (Inicia uma branch BDD guiada)
2. `npm run task:verify` (Roda os Lint/Tests/Crates Checks)
3. `npm run task:finish` (Gera changesets e abre o Pull Request orgânico)
4. `npm run task:rebrand` (Renomeia a marca e domínios em caso de necessidade extrema)

---

## Enforcing Gates in CI/CD

### GitHub Actions Workflow

```yaml
name: Quality Gates

on: [pull_request]

jobs:
  sdd-gate:
    if: contains(github.event.pull_request.labels.*.name, 'phase:sdd')
    steps:
      - name: Check ADRs exist
        run: |
          test -f specs/ADRs/ADR-*.md || exit 1
      
      - name: Check TODOs in specs
        run: |
          ! grep -r "TODO\|TBD" specs/ || exit 1
  
  bdd-gate:
    if: contains(github.event.pull_request.labels.*.name, 'phase:bdd')
    steps:
      - name: Run integration tests
        run: npm run test:integration
      
      - name: Ensure tests fail (red phase)
        run: |
          npm run test:integration && exit 1 || exit 0
  
  tdd-gate:
    if: contains(github.event.pull_request.labels.*.name, 'phase:tdd')
    steps:
      - name: Run unit tests
        run: npm test
      
      - name: Check coverage ≥80%
        run: npm run test:coverage -- --min-coverage=80
  
  ddd-gate:
    if: contains(github.event.pull_request.labels.*.name, 'phase:ddd')
    steps:
      - name: Run all tests
        run: npm test
      
      - name: Ensure tests pass (green phase)
        run: npm test
      
      - name: Check changeset exists
        run: |
          test -n "$(ls .changeset/*.md 2>/dev/null | grep -v README)" || exit 1
      
      - name: Lint
        run: npm run lint
      
      - name: Build
        run: npm run build
```

---

## Anti-Patterns to Avoid

### ❌ Writing code before specs

```typescript
// ❌ BAD: Started implementing without spec
class Storage {
  // ... 300 lines of code ...
  // Wait, what was the interface supposed to be?
}
```

### ❌ Tests after implementation

```typescript
// ❌ BAD: Tests written to match existing code (not behavior)
it("returns undefined when key not found", () => {
  // This is testing implementation detail, not requirement
  expect(storage.get("missing")).toBe(undefined);
});
```

### ❌ Skipping tests for "simple" code

```typescript
// ❌ BAD: "This function is too simple to test"
function merge(a, b) {
  return { ...a, ...b };  // Actually has subtle bugs with nested objects
}
```

### ❌ Merging failing tests

```typescript
// ❌ BAD: "I'll fix the tests later"
describe.skip("Sync tests", () => {
  // Tests that don't pass yet
});
```

---

## When to Revisit SDD

SDD isn't "set and forget." Return to SDD when:

- **Architecture assumptions are wrong** (PoC reveals blocker)
- **Requirements change** (new user needs discovered)
- **Technology choice fails** (performance, compatibility issues)
- **Scope expands** (new features need new decisions)

**Process**: Create amendment ADR, update specs, propagate changes to BDD/TDD.

Example:

```
specs/ADRs/
├── ADR-002-storage-strategy.md         # Original
└── ADR-002-storage-strategy-AMENDED.md  # Revised after PoC
```

---

## Summary

| Phase | Purpose | Deliverable | Test Status |
|-------|---------|-------------|-------------|
| **SDD** | What to build | ADRs + Specs | N/A |
| **BDD** | Expected behavior | Integration tests | 🔴 RED |
| **TDD** | Component contracts | Unit tests | 🔴 RED |
| **DDD** | Implementation | Production code | 🟢 GREEN |

**Key Insight**: Tests fail FIRST (red), then code makes them pass (green). This prevents:

- Implementing wrong features
- Skipping edge cases
- Accumulating technical debt
- Regressions going unnoticed

**Result**: Predictable, measurable progress toward high-quality software.

---

## � Branch & Release Flow

### Branch Model

```
feature/xyz ──┐
feature/abc ──┤──► develop ──► main ──► (packages published)
fix/yyy ───────┘       ▲                      │
                       │                      │
                       └──── auto-rebase ◄────┘
```

- **`main`** — produção, protegido. Nunca recebe push direto.
- **`develop`** — integração contínua. Base para todas as feature branches.
- **`feature/*`, `fix/*`, `docs/*`** — ramificam de `develop`, voltam para `develop` via PR.

### Ciclo completo de uma feature

```bash
# 1. Criar branch a partir de develop
git checkout develop && git pull origin develop
git checkout -b feature/minha-feature

# 2. Trabalhar, commitar, push
git push origin feature/minha-feature

# 3. Abrir PR → develop  (CI: testes, lint, type-check, changeset)
# 4. Merge em develop (qualquer estratégia funciona)

# 5. Quando develop estiver pronto para release:
#    Abrir PR: develop → main  
# 6. Aprovar e mergear (estratégia: "Rebase and merge" para timeline linear)

# 7. ✅ O workflow sync-develop.yml faz rebase automático de develop.
#    Não é necessário nenhuma ação manual.
```

### Estratégia de merge

- **Em `develop`**: qualquer estratégia funciona (squash, rebase, ou merge commit)
- **Em `main`**: prefira **rebase** para manter timeline linear
- O workflow `sync-develop.yml` automaticamente rebasa `develop` sobre `main` após qualquer push em `main`, independente da estratégia usada

### Release via Changesets

1. Changesets acumulam em `develop` durante o sprint (arquivo em `.changeset/`).
2. Após o merge `develop → main`, o workflow `release-changesets.yml` cria automaticamente um PR de versão (`chore(release): version packages`) no `main`.
3. Após esse PR ser aprovado, mergear com **rebase** também para manter linear.
4. Os pacotes são publicados no npm/crates.io.
5. O `sync-develop.yml` rebasa `develop` novamente.

### Sync automático falhou?

Se há conflitos no rebase (commits simultâneas em `develop` e `main` com mudanças na mesma região), o workflow `sync-develop.yml` abre um issue de manutenção. Fix manual:

```bash
git fetch origin
git checkout develop
git rebase origin/main

# Resolver conflitos (editor abre automaticamente)
# ...editar, depois:
git add .
git rebase --continue

git push -f origin develop
```

---

## �🏗 Source Sovereignty & Hygiene

### 1. Tracking Policy: Source vs. Derivatives
To avoid repository bloating and ensure reproducibility:
- **Track Only Source**: `.ts`, `.wit`, `.ld.json`, `.md`.
- **Ignore Derivatives**: `.js`, `.d.ts`, binary `.wasm` (managed by CI/build).
- **Cleanup**: Run `npm run clean:derivatives` to purge ignored artifacts.

### 2. Dual-Mode Resolution (`reso.mjs`)
The project supports a dynamic resolution switcher to balance speed and rigor:
- **Source Mode (`node scripts/reso.mjs src`)**: Instant DX with direct `src/` imports.
- **Dist Mode (`node scripts/reso.mjs dist`)**: CI/Release verification against build artifacts.

---

**See Also**:

- [roadmaps/MAIN.md](../roadmaps/MAIN.md) — How this workflow applies to releases
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Developer workflow
- [specs/ADRs/](../specs/ADRs/) — Architecture decisions

**Last Updated**: March 2026
