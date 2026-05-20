# ADR-001: Monorepo Structure and Workspace Boundaries

**Status**: Accepted  
**Date**: 2026-03-06  
**Deciders**: Core Team  
**Related**: [ADR-008 (Tech Boundary)](ADR-008-ecosystem-technology-boundary.md)

---

## Context

Refarm is composed of multiple packages with different responsibilities:

- **Apps**: `refarm` (sovereign CLI — daily driver), `farmhand` (task execution host), `dev`/`me` (web surfaces)
- **Packages**: independent service blocks and provider adapters (infra, contracts, runtime, UI primitives)
- **Shared**: `wit/`, `schemas/`, `docs/`, `specs/`

**Key requirements**:

1. **Primitive independence**: Packages must be usable outside Refarm
2. **Shared tooling**: Single TypeScript config, linting, testing
3. **Efficient builds**: Avoid rebuilding unchanged packages
4. **Clear boundaries**: Apps consume packages, packages never import apps
5. **Plugin examples**: Demonstrate WIT contract usage

**The question**: How do we structure the monorepo to satisfy these constraints while maintaining developer ergonomics?

---

## Decision

**We adopt Turborepo with pnpm workspaces and enforce strict dependency boundaries.**

> **Updated 2026-05-15:** Migrated from npm workspaces to pnpm workspaces (see pnpm-workspace.yaml). Workspace deps use `"workspace:*"` specifiers. Package manager pinned to `pnpm@11.1.2` via `packageManager` field + corepack.

### Workspace Structure

```
refarm/
├── package.json              # Root workspace config
├── turbo.json                # Build pipeline orchestration
├── tsconfig.json             # Base TypeScript config
│
├── apps/                     # Applications (depend on packages)
│   ├── refarm/               # Sovereign CLI — daily driver (@refarm.dev/refarm)
│   ├── farmhand/             # Task execution host (@refarm.dev/farmhand)
│   ├── dev/                  # Developer web surface
│   └── me/                   # Identity web surface
│
├── packages/                 # Independent primitives (NO app dependencies)
│   ├── infra-contract-v1/    # Provider-neutral provisioning contracts
│   ├── infra-cloudflare/     # Cloudflare provider adapter
│   ├── infra-turbo-cache/    # Turbo Remote Cache service block
│   ├── tractor/              # Authoritative kernel — Rust WASM runtime (see ADR-059)
│   ├── tractor-ts/           # Conformance harness only — TS reach where Rust isn't yet; not for critical logic
│   └── …                     # Storage, runtime, stream, context packages
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
| **packages/** | External libraries, other packages/ | apps/ |
| **Shared** (wit/, schemas/) | Nothing | Everything |

### apps/refarm as the convergence point

`apps/refarm` is the sovereign CLI and the daily driver — the surface through which the user interacts with everything Refarm builds. Packages are building blocks; `apps/refarm` is where those blocks become user-facing commands.

**Implication for new work:** when a package (infra provider, service block, CI tool, runtime primitive) reaches a level of maturity that a user would want to invoke it directly, the expected destination is a command in `apps/refarm`. Design packages with that surface in mind, even if the command comes later than the package itself.

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

**Chosen: Turborepo** balances speed (caching), simplicity (extends pnpm workspaces), and extraction capability.

---

## Consequences

### Positive

1. **Fast incremental builds**: Turborepo caches unchanged packages
2. **Simple mental model**: pnpm workspaces + pipeline orchestration
3. **Primitive independence**: Packages have zero Refarm-specific deps
4. **Easy extraction**: Copy `packages/storage-sqlite/` → new repo, works immediately
5. **Shared tooling**: One `tsconfig.json`, one linting config, one CI workflow

### Negative

1. **Build order awareness**: Developers must understand dependency graph
2. **Workspace isolation**: pnpm uses non-hoisted layout by default (`shamefully-hoist=false`), eliminating phantom dependency bugs; lockfile is `pnpm-lock.yaml`
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
