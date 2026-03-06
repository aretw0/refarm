# 🚀 Quick Start - Validações Pre-Sprint 1

**Objetivo**: Executar validações WASM + SQLite antes de iniciar o Sprint 1  
**Tempo estimado**: 3-4 dias (16-20 horas)  

**Status**: Pronto para execução  
**Docs de Troubleshooting**: [RUST_WINDOWS_TROUBLESHOOTING.md](./RUST_WINDOWS_TROUBLESHOOTING.md)

---

## 🐳 Opção Dev Container (recomendada no Windows)

Se quiser evitar dependências locais de MSVC/link.exe, use o ambiente containerizado:

1. No VS Code: `Dev Containers: Reopen in Container`
2. Aguarde o `post-create` finalizar (instala Rust targets + cargo tools)
3. Rode os passos deste guia dentro do terminal do container

Arquivos criados:

- `.devcontainer/devcontainer.json`
- `.devcontainer/post-create.sh`

Isso padroniza Node 22 + Rust + targets WASM em Linux para todo o time.

---

## 📋 Checklist Rápido

### Windows Host (PowerShell)

```powershell
# 1. Setup Rust toolchain
cd validations
.\setup-rust-toolchain.ps1

# 2. Compilar plugin WASM
cd wasm-plugin\hello-world
rustup target add wasm32-wasip1
cargo component build --release

# 3. Testar no browser
cd ..\host
npm install
copy ..\hello-world\target\wasm32-wasip1\release\hello_world_plugin.wasm public\hello-world-plugin.wasm
npm run dev

# 4. Rodar benchmarks SQLite
cd ..\..\sqlite-benchmark
npm install
npm run bench:all
```

### Dev Container (Linux/bash)

```bash
# 1. Setup Rust toolchain
# PULE: post-create já instala rust + targets + cargo-component + wasm-tools

# 2. Compilar plugin WASM
cd validations/wasm-plugin/hello-world
rustup target add wasm32-wasip1
cargo component build --release

# 3. Testar no browser
cd ../host
npm install
cp ../hello-world/target/wasm32-wasip1/release/hello_world_plugin.wasm public/hello-world-plugin.wasm
npm run dev

# 4. Rodar benchmarks SQLite
cd ../../sqlite-benchmark
npm install
npm run bench:all
```

Verificar: sem erros (warnings sobre "yanked" são normais).  
Detalhes: [RUST_SETUP_NOTES.md](./RUST_SETUP_NOTES.md).

---

## 🎯 Fase 1: WASM + WIT (2 dias)

### Passo 1: Setup Toolchain

#### Windows Host

```powershell
cd validations
.\setup-rust-toolchain.ps1
```

#### Dev Container (Linux)

```bash
# pular: post-create já fez setup
rustc --version
cargo-component --version
wasm-tools --version
```

**Possível Warning**:

```
warning: package `wit-parser v0.219.1` in Cargo.lock is yanked
```

✅ **Isso é normal e não-bloqueador.** O script usa versão recente sem `--locked`.  
📖 Ver [RUST_SETUP_NOTES.md](./RUST_SETUP_NOTES.md) para detalhes.

**Verificação**:

- ✅ `rustc --version` funciona
- ✅ `cargo-component --version` funciona
- ✅ `wasm-tools --version` funciona

### Passo 2: Compilar Plugin

#### Windows Host (PowerShell)

```powershell
cd wasm-plugin\hello-world

# Opcao A: Generico (recomendado)
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release

# Opcao B: Com WASI (cargo-component)
rustup target add wasm32-wasip1
cargo component build --release
```

#### Dev Container (Linux/bash)

```bash
cd validations/wasm-plugin/hello-world

# Opcao A: Generico (recomendado)
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release

# Opcao B: Com WASI (cargo-component)
rustup target add wasm32-wasip1
cargo component build --release
```

**Sucesso esperado**:

- Arquivo gerado em `target/.../hello_world_plugin.wasm` (path depende da opcao)
- Tamanho: < 500KB
- Sem erros de compilação

**Se houver erro**:

- ❌ `wasm32-wasi not supported`: Ver [Error 1](./RUST_WINDOWS_TROUBLESHOOTING.md#-erro-1-wasm32-wasi-não-suportado)
- ❌ `link.exe not found`: Ver [Error 2](./RUST_WINDOWS_TROUBLESHOOTING.md#-erro-2-linkexe-não-encontrado)
- ❌ `cargo-component: command not found`: Ver [Error 3](./RUST_WINDOWS_TROUBLESHOOTING.md#-erro-3-cargo-component--wasm-tools-não-no-path)

### Passo 3: Inspecionar WASM Component

```bash
wasm-tools component wit target\wasm32-wasip1\release\hello_world_plugin.wasm
```

**Saída esperada**: Interface WIT visível (setup, ingest, push, teardown, metadata)

### Passo 4: Testar no Browser

#### Windows Host (PowerShell)

```powershell
cd ..\host
npm install

# Copiar WASM (ajuste path conforme opcao A ou B)
# Opcao A:
copy ..\hello-world\target\wasm32-unknown-unknown\release\hello_world_plugin.wasm public\hello-world-plugin.wasm
# Opção B:
# copy ..\hello-world\target\wasm32-wasip1\release\hello_world_plugin.wasm public\hello-world-plugin.wasm

npm run dev
```

#### Dev Container (Linux/bash)

```bash
cd ../host
npm install

# Copiar WASM (ajuste path conforme opção A ou B)
# Opção A:
cp ../hello-world/target/wasm32-unknown-unknown/release/hello_world_plugin.wasm public/hello-world-plugin.wasm
# Opção B:
# cp ../hello-world/target/wasm32-wasip1/release/hello_world_plugin.wasm public/hello-world-plugin.wasm

npm run dev
```

**Fluxo de teste**:

1. Abrir <http://localhost:5173>
2. Clicar "1. Carregar Plugin" -> Ver status "Plugin carregado"
3. Clicar "2. Setup" -> Ver log "Hello from Rust WASM setup!"
4. Clicar "3. Ingest" -> Ver log "Stored node with ID: ..."
5. Clicar "4. Metadata" -> Ver info do plugin
6. Clicar "5. Teardown" -> Ver log "Goodbye from Rust WASM!"

**Validar metricas**:

- ✅ Load Time: < 100ms
- ✅ Setup Time: < 10ms
- ✅ Ingest Time: < 10ms
- ✅ WASM Size: < 500KB

### Passo 5: Substituir Mock por jco Real (Opcional)

Se quiser testar com jco real (não obrigatório para validação):

```typescript
// Em host/src/main.ts, substituir mockInstantiatePlugin por:
import { instantiate } from '@bytecodealliance/jco';

const { instance } = await instantiate(wasmBytes, {
  'refarm:sdk/kernel-bridge': kernelBridge
});
```

**Nota**: jco v1.4+ pode ter incompatibilidades. Validar antes.

---

## 🏎️ Fase 2: SQLite Benchmark (1 dia)

### Passo 1: Rodar Benchmarks

#### Windows Host (PowerShell)

```powershell
cd validations\sqlite-benchmark
npm install
npm run bench:all
```

#### Dev Container (Linux/bash)

```bash
cd validations/sqlite-benchmark
npm install
npm run bench:all
```

Isso roda:

- `wa-sqlite.bench.ts`: 100k inserts + queries
- `sql-js.bench.ts`: 100k inserts + queries

### Passo 2: Analisar Resultados

Resultados aparecem no terminal:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 wa-sqlite RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Time:     [ms]
Load Time:      [ms]
Insert Time:    [ms] ([ops/sec])
...
```

### Passo 3: Documentar Decisão

Preencher `validations/sqlite-benchmark/results.md` com:

- Resultados brutos
- Comparação lado a lado
- Decisão final (wa-sqlite ou sql.js)
- Rationale baseado em dados

### Passo 4: Atualizar ADR-015

Copiar decisão para [specs/ADRs/ADR-015-sqlite-engine-decision.md](../specs/ADRs/ADR-015-sqlite-engine-decision.md).

---

## ✅ Critérios de Sucesso

### WASM + WIT

- [ ] Plugin compila sem erros
- [ ] Plugin carrega no browser
- [ ] Kernel bridge funciona (store-node, log)
- [ ] Métricas dentro dos targets
- [ ] Código documentado

### SQLite Benchmark

- [ ] Ambos engines testados
- [ ] Resultados documentados
- [ ] Decisão justificada com dados
- [ ] ADR-015 atualizado

---

## 🚫 Bloqueadores Conhecidos

### WASM + WIT

**Bloqueador Windows (CRÍTICO)**:

- ⚠️ **Visual Studio Build Tools com C++** (obrigatório para linker MSVC)
  - Download: <https://visualstudio.microsoft.com/visual-cpp-build-tools/>
  - Escolha workload: "Desktop development with C++"
  - Tempo: ~30 min instalar + restart PowerShell

**Se compilação falhar**:

- Ver [RUST_WINDOWS_TROUBLESHOOTING.md](./RUST_WINDOWS_TROUBLESHOOTING.md) para detalhes técnicos
- Verificar `rustc --version` >= 1.70
- Ler [docs/research/wasm-validation.md](../docs/research/wasm-validation.md)

**Se jco não funcionar**:

- Usar o mock (suficiente para validação)
- Investigar compatibilidade Component Model v1.0

### SQLite Benchmark

**Se wa-sqlite falhar no Node**:

- Pode precisar de env browser real (use Playwright)
- Benchmark atual é Node-only (simplificado)

**Se sql.js for mais rápido que esperado**:

- Normal! sql.js é puro JS, sem overhead WASM
- Trade-off: menor compatibilidade SQLite

---

## 📊 Próximos Passos Após Validação

1. ✅ Marcar validações como completas no [pre-sprint-checklist.md](../docs/pre-sprint-checklist.md)
2. ✅ Atualizar roadmap com data de início do Sprint 1
3. ✅ Começar SDD phase (especificações)

---

## 💡 Dica

Execute as validações em paralelo se tiver tempo:

- **Dia 1-2**: WASM + WIT (mais crítico)
- **Dia 2-3**: SQLite Benchmark (pode sobrepor)

Isso economiza ~1 dia no cronograma.
