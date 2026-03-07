# WASM Plugin Host - Validacao

Host TypeScript que carrega o plugin `hello-world-plugin.wasm` e valida comunicacao via WIT.

## Setup

```bash
npm install
# Copy WASM plugin to public folder
cp ../hello-world/target/wasm32-wasip1/release/hello_world_plugin.wasm public/hello-world-plugin.wasm
# Transpile WASM Component to JavaScript using jco
npm run build:wasm
```

**O que `build:wasm` faz:**
- Usa `@bytecodealliance/jco` para transpilar o WASM Component Model
- Gera JavaScript ESM em `src/generated/`
- Mapeia `refarm:sdk/kernel-bridge` para implementação host
- Resultado: `hello-world.js` +  `hello-world.core.wasm` + `hello-world.core2.wasm`

Este step é **automatico** no prebuild, então `npm run build` ou `npm run preview:static` executam o transpile antes de buildar.

## Modos de Execucao

### 1. Desenvolvimento (Vite + HMR)

```bash
npm run dev
```

- URL: `http://localhost:5173`
- Processo esperado: `node .../node_modules/.bin/vite`
- Uso: desenvolvimento manual com hot reload
- Observacao: em devcontainer, o HMR pode ficar instavel para automacao E2E

### 2. Preview estatico (Node-only, recomendado para testes)

```bash
npm run build
npm run preview:test
```

- URL: `http://127.0.0.1:4173`
- Processo esperado: `vite preview`
- Uso: ambiente deterministico para Playwright
- Recomendado para automacao E2E

### 3. Servidor estatico Node.js (alternativa leve)

```bash
npm run preview:static
```

- URL: `http://localhost:4174`
- Processo esperado: `serve dist`
- Uso: servidor HTTP simples sem features de dev (CORS, headers customizados)
- Util para diagnostico ou demo rapida

## Teste E2E de Regressao (Playwright)

```bash
npm run test:e2e
```

O comando acima:
1. Faz build de producao
2. Sobe `vite preview` em `127.0.0.1:4173`
3. Executa a spec `tests/e2e/plugin-lifecycle.spec.ts`
4. Valida ciclo completo: load -> setup -> ingest -> metadata -> teardown

Com modo visual:

```bash
npm run test:e2e:headed
```

## Como Inspecionar Processos em Background

```bash
ps -eo pid,ppid,cmd --sort=start_time | grep -E "vite|playwright|serve" | grep -v grep
lsof -iTCP -sTCP:LISTEN -P -n | grep -E "4173|4174|5173|node"
```

Interpretacao:
- `node .../.bin/vite` em `5173`: servidor de desenvolvimento (esperado para `npm run dev`)
- `node ... vite preview` em `4173`: servidor de preview para testes deterministicos (Playwright)
- `node ... serve` em `4174`: servidor estático simples (alternativa leve)

## Arquitetura jco Transpile

A validação usa **WASM Component Model** real via `@bytecodealliance/jco`:

```
┌─────────────────────────────────────┐
│   Rust (hello-world-plugin)         │
│   Compila → .wasm component         │
└────────────┬────────────────────────┘
             │
             ↓ jco transpile
┌─────────────────────────────────────┐
│   hello-world.js (ESM wrapper)      │
│   → imports kernel-bridge.js        │
│   → loads .core.wasm/.core2.wasm    │
└─────────────────────────────────────┘
             │
             ↓ import
┌─────────────────────────────────────┐
│   main.ts (TypeScript host)         │
│   → Vite build → dist/              │
└─────────────────────────────────────┘
```

**Benefícios:**
- ✅ WASM Component Model real (não é mock)
- ✅ WIT interface totalmente funcional
- ✅ Import ESM nativo no browser
- ✅ Host implementa `refarm:sdk/kernel-bridge` em JS puro

**Limitações:**
- Transpile é step de build (não runtime)
- Arquivos gerados são grandes (~170KB JS + 60KB WASM)
- Node.js modules externalizados (warnings no build)

## DX Guardrails (Node path no browser)

Para melhorar DX e reduzir risco de regressao, o host aplica duas protecoes:

1. Alias de `node:fs/promises` para shim browser (`src/shims/fs-promises-browser.ts`).
- Se um caminho Node-only for executado no browser por engano, falha com mensagem explicita.

2. Supressao opcional e seletiva de warning no Vite.
- Env var: `VITE_SUPPRESS_NODE_EXTERNALIZED_WARNING=1`
- Escopo: somente warning de externalizacao para `node:fs/promises`.

Exemplo:

```bash
VITE_SUPPRESS_NODE_EXTERNALIZED_WARNING=1 npm run build
```

Recomendacao:
- Dev local: manter warning ligado.
- CI controlado: suprimir apenas quando os guard rails estiverem ativos e E2E estiver verde.

## Leituras de decisao

- `docs/WARNING_PLAYBOOK.md`
- `docs/RUNTIME_STRATEGY_JS_TS_RUST.md`
- `docs/NAMING_STRATEGY_PLUGIN_VS_CONTAINER.md`

