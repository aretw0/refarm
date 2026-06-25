# Spec: Source Contract v1 (`source:v1`) — the Librarian Capability

**Status:** DRAFT — ready for implementation
**Authors:** Arthur Silva
**Date:** 2026-06-24
**Related:** [`docs/ECOSYSTEM_SUPPLY_MAP.md`](../../docs/ECOSYSTEM_SUPPLY_MAP.md), [`docs/VAULT_SEED_CONVERGENCE.md`](../../docs/VAULT_SEED_CONVERGENCE.md) (2026-06-24 amendment), `packages/storage-contract-v1` (pattern reference)

---

## Context & Motivation

O ecossistema (`vault-seed`, `agents-lab`) repete trabalho que o Refarm deveria fornecer. O
primeiro passo para parar de refazer — a *keystone* — é dar ao Refarm um **bibliotecário**:
a capacidade de obter uma cópia local estável de um repositório remoto para ler, buscar e
inspecionar, sem o custo de um clone completo a cada vez.

Essa primitiva já existe, mas no lugar errado e no formato errado: é a skill
`agents-lab/packages/git-skills/skills/git-checkout-cache` (SKILL.md + `checkout.sh`). É uma
*receita* shell, não um contrato. O Refarm não distribui receitas — distribui **capability
contracts** versionados (`storage:v1`, `sync:v1`, `identity:v1`): Types + conformance runner +
reference impl + telemetry. Esta spec define `source:v1` nesse idioma.

Com o bibliotecário no Refarm, o Refarm passa a inspecionar `vault-seed` e `agents-lab`
read-only para absorver lógica — alinhado com a doutrina já escrita em
`VAULT_SEED_CONVERGENCE.md`: *"Let Refarm inspect vault-seed as an external consumer through
read-only templates."*

### Decisões confirmadas

| Decisão | Escolha | Razão |
|---|---|---|
| Forma | Contrato `source:v1` (não agent-tool interno) | Terceiros implementam; consumidores importam. Idioma do Refarm. |
| Abstração | `source provider` agnóstico de mecanismo | Dois kinds **reais hoje**: `git` (remoto) e `local` (path já em disco). Não é YAGNI. |
| Kinds | `git` + `local` agora; `tarball` documentado, sem código | `local` é usado já (repos irmãos estão em disco); `tarball` (npm/crate) fica para quando houver consumo. |
| Operação principal | `materialize` (não `checkout`) | Kind-agnóstico: "me dê uma cópia local estável", clonando (git) ou linkando (local). |
| Implementação real | Package separado `@refarm.dev/source-git` | Espelha o split `storage-contract-v1` + `storage-sqlite`. O contrato roda sem rede; a impl git precisa de `git` no PATH. |

### Primeiro consumidor é o Refarm

Pelo gate de dogfooding (`ECOSYSTEM_SUPPLY_MAP.md`): este contrato só é *fornecível* depois que
o próprio Refarm o consome. O primeiro consumo é o agente do Refarm materializando
`vault-seed`/`agents-lab` via `source-git` para lê-los. O `dgk` (vault-seed) é consumidor
posterior, não o primeiro.

---

## 1. Contract interface (`packages/source-contract-v1/src/types.ts`)

```ts
export const SOURCE_CAPABILITY = "source:v1" as const;

export type SourceKind = "git" | "tarball" | "local";

export type SourceErrorCode =
  | "INVALID_REF"        // ref não parseável
  | "NOT_MATERIALIZED"   // status/refresh sobre algo nunca materializado
  | "NETWORK"            // clone/fetch falhou (git)
  | "DIRTY"              // checkout local sujo, ff impossível
  | "UNSUPPORTED_KIND"   // provider não suporta esse kind
  | "UNAVAILABLE"        // transiente
  | "INTERNAL";

/** Resultado determinístico de parsear um ref — SEM IO nem rede. */
export interface SourceLocation {
  kind: SourceKind;
  host?: string;   // ex: "github.com" (git)
  org?: string;    // ex: "aretw0" (git)
  repo?: string;   // ex: "agents-lab" (git)
  ref?: string;    // branch/tag/commit pedido (git)
  /** Path local determinístico onde a fonte vive (ou viverá). */
  path: string;
}

export interface MaterializeOptions {
  /** Raiz do cache. Default por kind (git: ~/.cache/checkouts). */
  cacheRoot?: string;
  /** Intervalo de frescor antes de re-fetch (git). Default 300s. */
  staleSeconds?: number;
  /** Estratégia de partial clone (git). Default "blob:none". */
  filter?: "blob:none" | "tree:0" | "none";
  /** Força update mesmo se fresco. */
  force?: boolean;
  /** Proíbe rede; usa só o que já está em cache. */
  offline?: boolean;
  /** Branch/tag/commit alvo (git). */
  ref?: string;
}

export type MaterializeAction =
  | "cloned"          // git: primeiro clone
  | "reused"          // cache fresco, nada a fazer
  | "fetched"         // git: buscou updates
  | "fast-forwarded"  // git: ff aplicado
  | "linked"          // local: path apontado, sem cópia
  | "noop";           // offline e já presente

export interface MaterializeResult {
  location: SourceLocation;
  action: MaterializeAction;
  /** HEAD resolvido após materializar (git: commit; local: opcional). */
  head?: string;
  /** true se estava obsoleto antes desta operação. */
  stale: boolean;
}

export interface SourceStatus {
  kind: SourceKind;
  materialized: boolean;
  path?: string;
  stale?: boolean;        // git
  clean?: boolean;        // git: sem mudanças não-commitadas
  head?: string;          // git: commit atual
  lastFetchedAt?: string; // git: ISO
}

export interface SourceTelemetryEvent {
  traceId: string;
  pluginId: string;
  capability: typeof SOURCE_CAPABILITY;
  operation: "resolve" | "materialize" | "status" | "refresh";
  kind?: SourceKind;
  durationMs: number;
  ok: boolean;
  errorCode?: SourceErrorCode;
}

export interface SourceProvider {
  readonly pluginId: string;
  readonly capability: typeof SOURCE_CAPABILITY;
  /** Quais kinds esta implementação suporta. Deve ser não-vazio. */
  readonly kinds: readonly SourceKind[];

  /** Parse puro → path determinístico. Sem IO, sem rede, idempotente. */
  resolve(ref: string): Promise<SourceLocation>;
  /** Garante uma cópia local usável (clone/reuse/fetch/ff para git; link para local). */
  materialize(ref: string, opts?: MaterializeOptions): Promise<MaterializeResult>;
  /** Estado atual sem mutar (materializado? stale? clean? head). */
  status(ref: string): Promise<SourceStatus>;
  /** Update forçado (equivale a materialize com force=true). */
  refresh(ref: string, opts?: MaterializeOptions): Promise<MaterializeResult>;
}

export interface SourceConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}
```

`schema.ts` valida os shapes de entrada/saída (mesmo padrão de `storage-contract-v1/src/schema.ts`).

---

## 2. Reference implementation (`src/in-memory.ts`)

Implementação `kind: "local"` sobre um **FS falso em memória** (Map de path → conteúdo). Roda
sem rede — é o que a conformance exercita. Demonstra o contrato; não é a impl de produção.

- `resolve(ref)` — parseia `local:<path>` ou path absoluto → `{ kind: "local", path }`, determinístico.
- `materialize(ref)` — se o path existe no Map → `action: "linked"`; idempotente.
- `status(ref)` — reflete presença no Map (`materialized`, `path`).
- `refresh(ref)` — re-aponta; `action: "linked"` ou `"noop"`.

---

## 3. Conformance runner (`src/conformance.ts`)

`runSourceV1Conformance(provider)` — espelha `runStorageV1Conformance`. Validações (total = 7):

1. `provider.capability === "source:v1"`.
2. `provider.pluginId` não-vazio.
3. `provider.kinds` não-vazio.
4. `resolve(ref)` é **determinístico**: mesmo ref chamado 2× → mesmo `path`, sem throw.
5. `materialize(ref)` retorna `MaterializeResult` com `location.path` e `action` válido.
6. `status(ref)` após materialize retorna `materialized: true` com `path` consistente.
7. `refresh(ref)` retorna um `MaterializeResult` válido.

`conformance.test.ts` roda o runner contra a reference impl de `in-memory.ts`.

---

## 4. Real git implementation (`packages/source-git/`)

Package separado. Porta a lógica de `agents-lab/.../git-checkout-cache/checkout.sh`:

| Contrato | Comportamento git |
|---|---|
| `resolve(ref)` | parseia `owner/repo` \| `host/org/repo` \| URL \| `git@…` → `{ kind:"git", host, org, repo, path: <cacheRoot>/<host>/<org>/<repo> }`. Sem rede. (= `checkout.sh --dry-run --path-only`) |
| `materialize(ref, opts)` | clone parcial (`--filter=blob:none`) se ausente → `cloned`; reuso se fresco → `reused`; `fetch` se stale (> `staleSeconds`) → `fetched`; `ff` se limpo e com upstream → `fast-forwarded`. |
| `status(ref)` | existência do checkout, `stale` por mtime/lastFetch, `clean` via `git status`, `head` via `git rev-parse`. |
| `refresh(ref, opts)` | `materialize` com `force: true` (= `checkout.sh --force-update`). |

- **Cache default:** `~/.cache/checkouts/<host>/<org>/<repo>` (mesma convenção do agents-lab — reuso, não invenção). Override por `opts.cacheRoot`.
- **Read-only por postura:** não editar no cache compartilhado; consumidores que precisem mutar criam worktree/cópia (nota já presente na skill original).
- **Erros:** falha de rede → `NETWORK`; checkout sujo em ff → `DIRTY`; ref inválido → `INVALID_REF`.

---

## 5. Package layout & SDK boundary (hub-and-adapters)

Princípio: a primitiva é uma peça de SDK desacoplada, usável por sistemas não-agênticos e
agênticos. O **hub** é o provider; superfícies (import direto, dispatch, cli, http, a2a) são
**adapters opcionais** que partem do mesmo provider. Nada no core conhece o kernel ou o
dispatch — carregado como plugin do Refarm, é o adapter de dispatch que o liga ao microkernel via
manifest; usado como SDK, importa-se direto. Mesma peça, portas diferentes.

```
# Hub — SDK puro, zero conhecimento de kernel/dispatch
packages/source-contract-v1/   # @…/source-contract-v1  (port + conformance + in-memory ref)
  src/{types,schema,conformance,conformance.test,in-memory,index}.ts
  package.json README.md CHANGELOG.md tsconfig*.json vitest.config.ts eslint.config.mjs
packages/source-git/           # @…/source-git  (provider git real; dep única: git no PATH)
  src/{provider,parse,git,index}.ts
  src/provider.test.ts         # conformance + smoke clonando repo real

# Adapters — opcionais, aditivos, um por superfície (construídos quando consumidos)
#   import direto         → nenhum adapter: `import { createGitSourceProvider }`
#   @…/source-dispatch    → registra o provider no dispatch-surface (consumo agêntico/kernel)
#   cli / http / a2a      → mesma forma, quando houver consumo
```

`source-contract-v1` é zero-dependency (tipos + validação pura). `source-git` depende só de `git`.
**Nenhum dos dois depende de `dispatch-surface`** — é o adapter `source-dispatch` que depende
deles. Assim a chamada direta nunca arrasta dispatch, e o longo prazo (kernel/agentes) entra sem
acoplar o core.

---

## 6. Ref parsing & cache semantics

- `owner/repo` → default `github.com`.
- Aceita `host/org/repo`, URL `https://…`, `git@host:org/repo.git`, e `local:<path>` / path absoluto (kind `local`).
- Path de cache é **determinístico** e derivável offline (`resolve` nunca toca a rede).
- `staleSeconds` default 300; `filter` default `blob:none`.

---

## 7. First consumer: Refarm agent (dogfood)

O agente do Refarm passa a materializar repos do ecossistema via `source-git`:

```
source-git.materialize("aretw0/agents-lab")  → path em cache
→ grep/read/find sobre o path para inspeção read-only
```

Isso fecha o gate de dogfooding e destrava a migração de lógica para o Refarm. Só depois disso
o contrato é promovido a consumo externo (`dgk` cacheando repos de referência).

**Default `git`, não `local`:** mesmo os repos irmãos estando em disco, o dogfood materializa um
clone limpo do ref (`git`), não a working tree viva (`local`). As árvores de trabalho estão
sujas — o próprio `VAULT_SEED_CONVERGENCE.md` registrou `vault-seed` "materially dirty" — e
inspeção para aprender quer estado commitado e determinístico. O kind `local` fica para quando se
quer explicitamente a árvore viva.

---

## 8. Verification plan

A conformance roda sem rede; o smoke do `source-git` precisa de `git` no PATH.

1. **Gate de contrato:** `npm run test:capabilities` inclui `source:v1`; conformance in-memory passa (7/7).
2. **Check intermediário (offline):** `resolve("aretw0/agents-lab")` 2× → mesmo path, sem rede.
3. **Smoke (rede):** `source-git.materialize("aretw0/agents-lab")` → `action: "cloned"` na 1ª vez, `"reused"` na 2ª dentro de `staleSeconds`; `status()` reporta `materialized: true`, `clean: true`.
4. **Gate final:** lint + type-check + testes do package verdes antes de promover.

---

## 9. Out of scope / future

- **`tarball` kind** — inspeção de npm/crate publicado; só quando houver consumo.
- **Consumo pelo `dgk`** — `dgk` importar `source:v1` para cachear repos de referência; depois do dogfood do Refarm.
- **Escopo npm** — `@aretw0` (contratos) vs `@refarm.dev` (ds/homestead): inconsistência a fechar antes de publicar este contrato (ver `ECOSYSTEM_SUPPLY_MAP.md`, ordem de migração #2).
- **Worktree/cópia mutável** — adapter para consumidores que precisam editar, não só ler.

## 10. Resolved decisions (2026-06-24)

- **Onde mora:** `packages/source-contract-v1` + `packages/source-git`. Peças de SDK standalone,
  não dentro de `toolbox`/`agent-tools` (isso acoplaria a um consumidor). Ver §5.
- **Direct vs dispatch:** o provider é o hub; chamada direta (SDK puro) é a base, usável por
  sistemas não-agênticos sem nenhuma dependência de dispatch. `dispatch-surface` é **um** adapter
  entre vários (cli/http/a2a), aditivo, num package `source-dispatch` separado, construído no
  dogfood quando o agente/kernel o conecta. Não se centraliza no dispatch — centraliza-se no
  provider; os adapters partem dele. O contrato já é dispatch-agnóstico, então o adapter entra sem
  tocar no core.
- **`source-local` separado:** não agora. O kind `local` continua de primeira classe no contrato
  (adicionar real depois é não-breaking) e a reference in-memory já o prova. Default do dogfood é
  `git` (snapshot limpo; working trees irmãs estão sujas — §7). `source-local` real só quando um
  consumidor precisar da árvore local viva.
