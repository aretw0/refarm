# Capability Contracts — Distribution Status

**Status:** � **READY FOR v0.1.0 ALPHA DISTRIBUTION**

✅ All 4 foundational contracts are complete and tested.  
✅ Repository configured for publication to `@aretw0` scope (personal profile).  
✅ CI/CD pipeline ready (Gate 1 completion pending in GitHub repo settings).

> **See Also**: [REFARM_PERSONAL_DAILY_DRIVER.md](../docs/REFARM_PERSONAL_DAILY_DRIVER.md) — Publishing strategy and why we publish contracts first.

---

## What's Being Published in v0.1.0

### 4 Capability Contracts (Immutable Interfaces)

These packages define **what it means to be Refarm-compatible**. They are low-risk, high-value publications because they are *interfaces*, not *implementations*.

#### 1. **@aretw0/storage-contract-v1** (0.1.0)
   - **Purpose**: Capability contract for any Refarm-compatible storage backend
   - **Conformance**: 6 validations ✅
   - **Stability**: **Immutable** (breaking changes → storage-contract-v2)
   - **Use Case**: Third-party storage implementations (Firebase, DynamoDB, S3, etc.)
   - **Status**: Ready for publication

#### 2. **@aretw0/sync-contract-v1** (0.1.0)
   - **Purpose**: CRDT delta format for interoperable sync
   - **Conformance**: 4 validations ✅
   - **Stability**: **Immutable**
   - **Use Case**: Loro, Automerge, or any CRDT can implement this interface
   - **Status**: Ready for publication

#### 3. **@aretw0/identity-contract-v1** (0.1.0)
   - **Purpose**: Capability contract for identity/signing
   - **Conformance**: 4 validations ✅
   - **Stability**: **Immutable**
   - **Use Case**: Nostr, OPAQUE, custom identity systems can implement
   - **Status**: Ready for publication

#### 4. **@aretw0/plugin-manifest** (0.1.0)
   - **Purpose**: WASM plugin descriptor schema and validation helpers
   - **Conformance**: 2 validations ✅
   - **Stability**: **Immutable**
   - **Use Case**: Any system needs to describe plugins in a standard way
   - **Status**: Ready for publication

---

## What's **Not** Being Published Yet (Tier 2)

### Reference Implementations (Mature in Private First)

These are the actual tools and systems. We keep them private for 3–6 months to stabilize before publishing.

| Package | v0.1.0 Status | Target Publication | Reason |
|---------|---------------|--------------------|--------|
| `tractor` (Rust) | ✅ Code ready, tests pass | May–June 2026 | Consumer testing (Gate 2/3) still WIP |
| `apps/me` (Homestead) | 🚧 Gate 3 in progress | July+ 2026 | Needs 6+ months daily use to validate UX |
| `barn` (Plugin lifecycle) | 🚧 SDD/BDD phase | May 2026 | Must be rock-solid for `installPlugin()` |
| `silo` (Secrets) | 🚧 Early design | June 2026 | Personal threat model; tailor to daily use |
| `creek` (Telemetry) | 🔄 Planned | v0.2.0 | Personal observability; genericize later |
| `plugin-tem` (AI) | 🚧 In progress | v0.2.0+ | Tightly personal; publish as example, not reference |
| `windmill` (Automation) | 🚧 In progress | v0.2.0 | Personal workflows first; ecosystem later |

---

## Developer Experience (v0.1.0)

### For Contract Users
- ✅ Package READMEs with installation/usage examples
- ✅ Conformance tests runnable in external projects
- ✅ TypeScript declarations exported
- ✅ ESM-only (modern, no dual-bundle complexity)
- ✅ Zero runtime dependencies (pure types + validation logic)
- ✅ CI example for external projects
- ✅ Third-party plugin example in `examples/third-party-plugin/`

### For Daily Driver Users (You)
- ✅ Tractor daemon boots locally reliably
- 🚧 Homestead ↔ Tractor integration (Gate 3) still stabilizing
- 🚧 Plugin hot-swap validated (3+ plugins needed)
- 🚧 Offline sync confirmed (7-day test required)
- 🚧 100% test coverage on implementations

---

## Publishing Configuration (Ready)

### npm `package.json` Fields
- ✅ `files` field (only dist + README shipped)
- ✅ `publishConfig.access: "public"`
- ✅ Repository/homepage URLs configured
- ✅ Version bumped to `0.1.0`

### CI/CD
- ✅ `publish-packages.yml` workflow exists
- ⏳ Gate 1 (GitHub variables) pending: `RELEASE_AUTOMATION=true`, `RELEASE_OWNER=aretw0`
- ⏳ NPM token provisioned in GitHub Secrets

---

## Publishing Timeline

### Phase A: Pre-Publish (This Week)
- [ ] Set `RELEASE_AUTOMATION=true` in GitHub repository settings
- [ ] Set `RELEASE_OWNER=aretw0`
- [ ] Verify `NPM_TOKEN` has publish access to `@aretw0` scope
- [ ] Run `npm publish --dry-run` for each contract (should pass)

### Phase B: Publish (Next Week)
```bash
git tag @aretw0/storage-contract-v1@0.1.0 && git push origin @aretw0/storage-contract-v1@0.1.0
git tag @aretw0/sync-contract-v1@0.1.0 && git push origin @aretw0/sync-contract-v1@0.1.0
git tag @aretw0/identity-contract-v1@0.1.0 && git push origin @aretw0/identity-contract-v1@0.1.0
git tag @aretw0/plugin-manifest@0.1.0 && git push origin @aretw0/plugin-manifest@0.1.0
```
- CI triggers: `publish-packages.yml` publishes all 4 to npm

### Phase C: Post-Publish (Verification)
- [ ] Verify on npm: `npm info @aretw0/storage-contract-v1`
- [ ] Update this file with publish timestamps
- [ ] Create GitHub Release for `v0.1.0-contracts`
- [ ] Announce (optional)

### Phase D: Daily Driver Stabilization (Ongoing)
- Continue using Refarm as personal daily driver
- Complete Gate 2/3 (Tractor consumer testing)
- Mature Barn plugin lifecycle
- Plan v0.2.0 publication (mid-2026)

---

## Repository State

- **Current version**: `v0.0.1-dev`
- **Next version**: `v0.1.0` (contracts only; core kernel stays `v0.0.x`)
- **Scope**: `@aretw0` (personal profile until org migration)
- **Branch**: `main` (releases only); `develop` (daily development)
- ✅ Keywords for npm discovery
- ✅ MIT license

## What Developers Get

### 1. Installation

```bash
npm install @refarm.dev/storage-contract-v1
npm install @refarm.dev/sync-contract-v1
npm install @refarm.dev/identity-contract-v1
npm install @refarm.dev/plugin-manifest
```

### 2. Implementation

Implement interface + export factory:

```typescript
import { type StorageProvider, STORAGE_CAPABILITY } from "@refarm.dev/storage-contract-v1";

export class MyProvider implements StorageProvider {
  readonly pluginId = "@mycompany/my-plugin";
  readonly capability = STORAGE_CAPABILITY;
  
  // ... implement methods
}

export function createMyProvider(): StorageProvider {
  return new MyProvider();
}
```

### 3. Validation

Add conformance test:

```typescript
import { runStorageV1Conformance } from "@refarm.dev/storage-contract-v1";

it("passes storage:v1", async () => {
  const provider = new MyProvider();
  const result = await runStorageV1Conformance(provider);
  expect(result.pass).toBe(true);
});
```

### 4. Publishing

Standard npm workflow:

```bash
npm run type-check
npm run test  # includes conformance
npm run build
npm publish
```

## Known Limitations (Alpha Quality)

1. **Version 0.1.0** — Expect breaking changes before 1.0
2. **No observability pipeline** — Telemetry hooks defined but not wired yet
3. **No kernel loader** — Contracts ready, runtime admission gate not implemented
4. **Reference implementations incomplete** — storage-sqlite is in-memory only
5. **No CHANGELOG.md** — Not tracking breaking changes formally yet
6. **Documentation incomplete** — Per-package docs exist, ecosystem guide missing

## Pre-Publishing Checklist

⚠️ **Executar ANTES do transfer do repositório:**

- [x] Build all 4 packages: ✅ Compilados
- [x] Run conformance: ✅ `npm run test:capabilities` passing
- [x] Type-check: ✅ Sem erros
- [x] Test reference implementations: ✅ storage-sqlite passing
- [x] Validate manifests: ✅ plugin-manifest validation working
- [x] Update package.json URLs: ✅ Apontando para refarm-dev
- [x] READMEs criados: ✅ Todos os 4 pacotes documentados
- [ ] **Transfer repositório** para refarm-dev org
- [ ] **Configurar NPM_TOKEN** no GitHub Secrets
- [ ] **Criar workflow** `.github/workflows/publish-packages.yml`
- [ ] **Primeiro publish** via git tag + CI/CD

## Publishing Commands (VIA CI/CD APENAS)

**NÃO rodar manualmente! Usar git tags:**

```bash
# Exemplo de workflow correto:
npm version patch  # Bump version
git add package.json
git commit -m "chore: release v0.1.1"
git tag @refarm-dev/storage-contract-v1@0.1.1
git push origin @refarm-dev/storage-contract-v1@0.1.1
# → GitHub Actions executa build + tests + publish automaticamente
```

**Dry-run local (para testar):**
```bash
npm publish --dry-run -w packages/storage-contract-v1
# Mostra o que SERIA enviado, sem enviar
```

## Third-Party Developer Journey

1. **Discovery**: Find contracts via npm search ("refarm plugin contract")
2. **Installation**: `npm install @refarm.dev/storage-contract-v1`
3. **Implementation**: Copy example from README, adapt to their needs
4. **Validation**: Add conformance test (`runStorageV1Conformance()`)
5. **Testing**: Run conformance in CI (examples provided)
6. **Publishing**: Standard npm publish workflow
7. **Distribution**: Users install their plugin, use typed interface
8. **Integration**: (Future) Kernel loads plugin, validates manifest + conformance

## Ecosystem Maturity Path

- **Alpha (NOW)**: Contracts published, third-party devs can experiment
- **Beta**: Kernel admission gates wired, telemetry pipeline active
- **Stable 1.0**: Breaking change moratorium, performance benchmarks, ecosystem plugins

## Success Metrics

- [ ] First third-party plugin published using contracts
- [ ] Conformance test catches real bug before merge
- [ ] CI gate blocks non-conformant plugin
- [ ] Developer completes plugin in <4 hours (with docs)

## Next Steps

1. **Publish alpha versions** to npm registry
2. **Adapt sync-crdt to sync:v1** (dogfood our own contracts)
3. **Adapt identity-nostr to identity:v1** (validate identity contract)
4. **Build kernel admission gate** (load plugins, validate manifests)
5. **Wire telemetry pipeline** (collect observability events)
6. **Create first "real" plugin** (CSV importer or similar)

---

**Summary for stakeholders:** Os contratos já podem ser distribuídos para desenvolvedores externos testarem. READMEs, configuração de publicação e exemplos standalone estão prontos. É uma versão alpha (0.1.0) com expectativa de breaking changes antes de 1.0, mas já é funcional para early adopters validarem a abordagem.
