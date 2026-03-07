# Capability Contracts — Distribution Status

**Status:** 🚧 **READY FOR ALPHA DISTRIBUTION (AFTER REPO MIGRATION)**

⚠️ **IMPORTANTE:** Pacotes NÃO foram publicados ainda. Aguardando:
1. Transfer do repositório para `github.com/refarm-dev`
2. Configuração do NPM automation token
3. Setup do CI/CD para publish seguro

Ver [docs/REPOSITORY_MIGRATION_GUIDE.md](../docs/REPOSITORY_MIGRATION_GUIDE.md) para detalhes.

## What's Ready

### 4 Contract Packages

1. **@refarm/storage-contract-v1** (0.1.0)
   - Conformance suite: 6 validations
   - README with examples
   - npm publish configuration

2. **@refarm/sync-contract-v1** (0.1.0)
   - Conformance suite: 4 validations
   - README with examples
   - npm publish configuration

3. **@refarm/identity-contract-v1** (0.1.0)
   - Conformance suite: 4 validations
   - README with examples
   - npm publish configuration

4. **@refarm/plugin-manifest** (0.1.0)
   - Validation helpers
   - README with schema docs
   - npm publish configuration

### Developer Experience

- ✅ Package READMEs with installation/usage examples
- ✅ Conformance tests runnable in external projects
- ✅ TypeScript declarations exported
- ✅ ESM-only (modern, no dual-bundle complexity)
- ✅ Zero runtime dependencies (pure types + validation logic)
- ✅ CI example for external projects
- ✅ Third-party plugin example in `examples/third-party-plugin/`

### Publishing Configuration

- ✅ `files` field (only dist + README shipped)
- ✅ `publishConfig.access: "public"`
- ✅ Repository/homepage URLs configured
- ✅ Keywords for npm discovery
- ✅ MIT license

## What Developers Get

### 1. Installation

```bash
npm install @refarm/storage-contract-v1
npm install @refarm/sync-contract-v1
npm install @refarm/identity-contract-v1
npm install @refarm/plugin-manifest
```

### 2. Implementation

Implement interface + export factory:

```typescript
import { type StorageProvider, STORAGE_CAPABILITY } from "@refarm/storage-contract-v1";

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
import { runStorageV1Conformance } from "@refarm/storage-contract-v1";

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
2. **Installation**: `npm install @refarm/storage-contract-v1`
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
