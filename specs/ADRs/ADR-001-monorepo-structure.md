# ADR-001: Monorepo Structure and Workspace Boundaries

**Status**: Accepted  
**Date**: 2026-03-06  
**Deciders**: Core Team  
**Related**: [ADR-008 (Tech Boundary)](ADR-008-ecosystem-technology-boundary.md)

---

## Context

Refarm is composed of multiple packages with different responsibilities:

- **Apps**: `kernel` (orchestration), `studio` (UI/IDE)
- **Packages**: `storage-sqlite`, `sync-crdt`, `identity-nostr` (independent primitives)
- **Examples**: `matrix-bridge` (plugin demonstration)
- **Shared**: `wit/refarm-sdk.wit`, `schemas/`, `docs/`, `specs/`

**Key requirements**:

1. **Primitive independence**: Packages must be usable outside Refarm
2. **Shared tooling**: Single TypeScript config, linting, testing
3. **Efficient builds**: Avoid rebuilding unchanged packages
4. **Clear boundaries**: Apps consume packages, packages never import apps
5. **Plugin examples**: Demonstrate WIT contract usage

**The question**: How do we structure the monorepo to satisfy these constraints while maintaining developer ergonomics?

---

## Decision

**We adopt Turborepo with npm workspaces and enforce strict dependency boundaries.**

### Workspace Structure

```
refarm/
├── package.json              # Root workspace config
├── turbo.json                # Build pipeline orchestration
├── tsconfig.json             # Base TypeScript config
│
├── apps/                     # Applications (depend on packages)
│   ├── kernel/               # Core orchestration (@refarm.dev/kernel)
│   │   ├── package.json      # deps: storage, sync (v0.1), identity (v0.2+)
│   │   └── src/index.ts
│   └── studio/               # Management UI (@refarm.dev/studio)
│       ├── package.json      # deps: kernel
│       └── src/
│
├── packages/                 # Independent primitives (NO app dependencies)
│   ├── storage-sqlite/       # @refarm.dev/storage-sqlite
│   │   ├── package.json      # ZERO refarm dependencies
│   │   └── src/index.ts
│   ├── sync-crdt/            # @refarm.dev/sync-crdt
│   │   ├── package.json      # deps: yjs ONLY
│   │   └── src/index.ts
│   └── identity-nostr/       # @refarm.dev/identity-nostr
│       ├── package.json      # deps: nostr-tools ONLY
│       └── src/index.ts
│
├── examples/                 # Plugin demonstrations (NOT published to npm)
│   └── matrix-bridge/        # Example WIT plugin
│
├── wit/
│   └── refarm-sdk.wit        # Shared WIT interface (versioned)
│
├── schemas/
│   └── sovereign-graph.jsonld # Shared JSON-LD schema
│
└── docs/, specs/, locales/   # Documentation (not in workspace)
```

### Dependency Rules (Enforced)

| Layer | Can Depend On | Cannot Depend On |
|-------|---------------|------------------|
| **apps/** | packages/, wit/, schemas/ | other apps/ |
| **packages/** | External libraries ONLY | apps/, other packages/, wit/ |
| **examples/** | packages/, wit/ | apps/ |
| **Shared** (wit/, schemas/) | Nothing | Everything |

### Workspace Configuration

**Root `package.json`**:

```json
{
  "name": "refarm",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "devDependencies": {
    "turbo": "^2.3.3",
    "typescript": "^5.7.3"
  }
}
```

**`turbo.json` Pipeline**:

```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

**Build order** (automatic via `^build` dependsOn):

```
1. packages/storage-sqlite
2. packages/sync-crdt
3. packages/identity-nostr
4. apps/kernel (waits for packages)
5. apps/studio (waits for kernel)
```

### TypeScript Configuration

**Root `tsconfig.json`**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  }
}
```

**Each workspace extends**:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

### Package Naming Convention

- **Published packages**: `@refarm.dev/storage-sqlite`, `@refarm.dev/sync-crdt`
- **Apps**: `@refarm.dev/kernel`, `@refarm.dev/studio` (not published directly)
- **Examples**: No npm scope (local only)

### Version Management

- **Strategy**: Independent versioning via Changesets
- **Tool**: `@changesets/cli`
- **Process**: Each package/app has its own `CHANGELOG.md` and version
- **Release**: Packages can be released independently (e.g., storage v0.2.0 while sync is v0.1.5)

---

## Alternatives Considered

### Alternative 1: Lerna Monorepo

**Pros**: Mature, widely adopted
**Cons**: Slower builds (no cache), complex config, maintenance burden

### Alternative 2: Nx Monorepo

**Pros**: Powerful computation cache, dependency graph
**Cons**: Heavy abstraction, complex setup, overkill for our scale

### Alternative 3: Separate Repositories

**Pros**: Maximum independence
**Cons**:

- Harder to coordinate changes across kernel + packages
- Duplicate tooling config (10+ repos)
- Cross-package refactors become painful
- Loses "radical ejection" principle (packages should be easily extractable)

**Chosen: Turborepo** balances speed (caching), simplicity (extends npm workspaces), and extraction capability.

---

## Consequences

### Positive

1. **Fast incremental builds**: Turborepo caches unchanged packages
2. **Simple mental model**: npm workspaces + pipeline orchestration
3. **Primitive independence**: Packages have zero Refarm-specific deps
4. **Easy extraction**: Copy `packages/storage-sqlite/` → new repo, works immediately
5. **Shared tooling**: One `tsconfig.json`, one linting config, one CI workflow

### Negative

1. **Build order awareness**: Developers must understand dependency graph
2. **Workspace hoisting**: npm hoists dependencies, can cause version conflicts (mitigated by `package-lock.json`)
3. **Monorepo size**: Checkout downloads all packages (minor issue with Git sparse checkout)

### Neutral

1. **Testing strategy**: Each package has its own tests (unit + integration)
2. **CI/CD**: Single GitHub Actions workflow, runs jobs per workspace
3. **Documentation**: Each package has `README.md`, shared docs in `docs/`

---

## Implementation Checklist

- [x] Root `package.json` with workspaces configured
- [x] `turbo.json` with build pipeline
- [x] Base `tsconfig.json`
- [ ] Dependency boundary linting (eslint-plugin-import rules)
- [ ] CI: Run `turbo build test lint` on PRs
- [ ] Documentation: Contributing guide with workspace commands

---

## References

- [Turborepo Handbook](https://turbo.build/repo/docs/handbook)
- [npm Workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces)
- [Changesets](https://github.com/changesets/changesets)
- Example: [Vercel Turborepo Starter](https://github.com/vercel/turbo/tree/main/examples/basic)
