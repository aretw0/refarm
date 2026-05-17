# Package Scaffold Generator & Conformance Linter — Design

**Goal:** Eliminar drift de scaffold entre os 59+ pacotes do monorepo com um gerador interativo (`pnpm turbo gen package`) e um linter de CI que bloqueia PRs com pacotes fora do padrão.

**Architecture:** Duas peças independentes — gerador para criação correta na origem, linter para detectar desvios em edições futuras. Nenhuma depende da outra; o linter não sabe como o pacote foi criado.

**Tech Stack:** Plop.js (via `turbo gen`), Node.js ESM para o linter, GitHub Actions.

---

## Tipos de Pacote Canônicos

Sete tipos cobrem todos os pacotes existentes e futuros do ecossistema:

| Tipo | Critério de classificação | Exemplos |
|---|---|---|
| `buildable` | `main`/`exports` aponta para `dist/`, build com `tsc` | `effort-contract-v1`, `prompt-contract-v1` |
| `source-only` | `main` aponta para `src/*.ts` | `event-contract-v1`, `infra-contract-v1` |
| `wasm-component` | `Cargo.toml` + scripts `build:wasm` e `build:transpile` | `heartwood` |
| `rust-only` | `Cargo.toml` sem surface JS/TS | `pi-agent`, `tractor`, `agent-tools` |
| `ui-library` | como `buildable` + exports `./styles/*` | `ds`, `homestead` |
| `js-tool` | `main` aponta para `src/*.mjs` ou `src/*.js` sem compilação TS | `toolbox` |
| `config-pkg` | sem `main`, sem build, só arquivos de configuração JSON/JS | `tsconfig`, `eslint-config` |

**Escape hatch:** `"scaffold": { "type": "exempt", "reason": "..." }` no `package.json` — obriga uma justificativa explícita. Reservado para desvios técnicos genuínos (ex: `tractor-ts` com `rootDir: ".."` por envolver o crate Rust `tractor`). Não é isenção de preguiça.

---

## Gerador (`turbo/generators/`)

### Estrutura de arquivos

```
turbo/generators/
  config.ts                    ← ponto de entrada Plop registra o generator "package"
  templates/
    buildable/
      package.json.hbs
      tsconfig.json.hbs
      tsconfig.build.json.hbs
      src/index.ts.hbs
      src/index.test.ts.hbs
    source-only/
      package.json.hbs
      tsconfig.json.hbs
      src/index.ts.hbs
    wasm-component/
      package.json.hbs
      Cargo.toml.hbs
      src/lib.rs.hbs
      wit/world.wit.hbs
    ui-library/
      package.json.hbs          ← igual buildable + export ./styles/*
      tsconfig.json.hbs
      tsconfig.build.json.hbs
      src/index.ts.hbs
      src/index.test.ts.hbs
    js-tool/
      package.json.hbs
      src/cli.mjs.hbs
    config-pkg/
      package.json.hbs
```

### Fluxo interativo

```
$ pnpm turbo gen package

? Package name (sem escopo, ex: my-contract-v1): effort-contract-v2
? Type: › buildable / source-only / wasm-component / ui-library / js-tool / config-pkg
? Description: Typed effort contract v2
? Private? (y/N): y
```

### Pós-geração automática

O gerador modifica o `tsconfig.json` raiz para adicionar a entrada `paths` do novo pacote — o passo mais esquecido em criações manuais:

```json
"@refarm.dev/effort-contract-v2": ["./packages/effort-contract-v2/src"]
```

Para `buildable` e `ui-library`, também adiciona o mapeamento para `dist/` apontando para `src/` (desenvolvimento in-monorepo usa source via paths).

O gerador adiciona `@refarm.dev/tsconfig: workspace:*` no `devDependencies` de pacotes `buildable`/`source-only`/`ui-library`, mas **não roda `pnpm install`** — o dev executa quando quiser.

### Templates canônicos

**`buildable/package.json.hbs`:**
```json
{
  "name": "@refarm.dev/{{name}}",
  "version": "0.1.0",
  "private": {{private}},
  "description": "{{description}}",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "@refarm.dev/tsconfig": "workspace:*",
    "typescript": "^6.0.3",
    "vitest": "^4.1.4"
  }
}
```

**`buildable/tsconfig.json.hbs`:**
```json
{
  "extends": ["../../tsconfig.json", "@refarm.dev/tsconfig/buildable.json"],
  "compilerOptions": {
    "outDir": "dist",
    "baseUrl": "../.."
  },
  "include": ["src/**/*"]
}
```

**`buildable/tsconfig.build.json.hbs`:**
```json
{
  "extends": ["./tsconfig.json", "@refarm.dev/tsconfig/build.json"],
  "compilerOptions": {
    "rootDir": "src"
  }
}
```

**`buildable/src/index.ts.hbs`:**
```typescript
export const {{constantName}}_CAPABILITY = "{{name}}:v1" as const;
```

**`buildable/src/index.test.ts.hbs`:**
```typescript
import { describe, it, expect } from "vitest";
import { {{constantName}}_CAPABILITY } from "./index.js";

describe("{{name}}", () => {
  it("exports capability marker", () => {
    expect({{constantName}}_CAPABILITY).toBe("{{name}}:v1");
  });
});
```

---

## Linter de CI (`scripts/validate-packages.mjs`)

### Classificação automática

O linter infere o tipo de cada pacote sem campo extra no `package.json`, em ordem de precedência:

1. Tem `Cargo.toml` + script `build:wasm` → `wasm-component`
2. Tem `Cargo.toml` sem surface JS → `rust-only` (skip, sem regras JS)
3. `main` bate com `./src/*.ts` → `source-only`
4. `main` bate com `./src/*.mjs` ou `./src/*.js` → `js-tool`
5. Tem export `./styles/*` + `main` aponta para `dist/` → `ui-library`
6. `main` ou exports apontam para `dist/` com script `build` tsc → `buildable`
7. Sem `main`, sem build, só config → `config-pkg`
8. `"scaffold": { "type": "exempt" }` → skip com log do motivo

### Regras por tipo

**`buildable` e `ui-library`:**
- `tsconfig.json` deve conter `"@refarm.dev/tsconfig/buildable.json"` no array `extends`
- `tsconfig.build.json` deve existir e conter `"@refarm.dev/tsconfig/build.json"` no array `extends`
- `package.json` deve ter script `build` contendo `tsc`
- `exports["."]` deve ter campos `import` e `types` apontando para `dist/`

**`source-only`:**
- `tsconfig.json` deve existir
- Não deve ter `tsconfig.build.json`
- Não deve ter script `build` que emita para `dist/`

**`wasm-component`:**
- Deve ter `Cargo.toml`
- Deve ter scripts `build:wasm` e `build:transpile`
- Deve ter script `build` que invoca os dois

**`js-tool`:**
- `main` deve apontar para `src/`
- Não deve ter `tsconfig.build.json`

**`config-pkg`:**
- Não deve ter `dist/` nos exports
- Não deve ter `tsconfig.build.json`

### Output

```
Validating 59 packages...

  ✓ effort-contract-v1        buildable
  ✓ event-contract-v1         source-only
  ✓ heartwood                 wasm-component
  ✗ sower                     buildable — tsconfig.json does not extend @refarm.dev/tsconfig/buildable.json
  ✗ barn                      buildable — tsconfig.build.json does not extend @refarm.dev/tsconfig/build.json
  ~ tractor-ts                exempt — rootDir: '..' wraps Rust tractor crate

2 violations found.
Run `pnpm turbo gen package` to see the expected scaffold for each type.
```

Exit code 0 se nenhuma violação. Exit code 1 caso contrário.

### Pacotes não-conformantes no dia 1

O linter vai flagrar `sower` e `barn` imediatamente — comportamento correto. O CI fica vermelho até migrarmos os tsconfigs deles para os presets `buildable.json`/`build.json`. Não isentamos; consertamos como fizemos com os 13 pacotes nessa sessão.

---

## CI Integration

### Novo job em `.github/workflows/test.yml`

```yaml
validate-scaffold:
  name: Validate package scaffold
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - run: node scripts/validate-packages.mjs
```

O job **não depende de `build`** — lê apenas JSON e verifica presença de arquivos. Roda rápido (~2s) e em paralelo com os outros jobs. É um required status check: PRs que introduzem pacotes fora do padrão não passam.

---

## Sequência de implementação

1. `turbo/generators/config.ts` + templates `buildable` (o tipo mais comum — valida o gerador end-to-end)
2. Templates restantes (`source-only`, `wasm-component`, `ui-library`, `js-tool`, `config-pkg`)
3. `scripts/validate-packages.mjs` com classificação e regras completas
4. Job `validate-scaffold` no CI
5. Migração de `sower` e `barn` para conformidade (o CI verde é o critério de done)

---

## Fora de escopo

- `apps/` — apps têm estrutura própria (binários compilados), não seguem o mesmo scaffold
- Gerador para `apps/`
- Integração com `refarm scaffold` CLI — avaliado em iteração futura
- Publicação automática de pacotes após scaffold
