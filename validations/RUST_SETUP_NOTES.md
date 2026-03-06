# Rust Toolchain Setup Issues & Decisions

**Data**: 2026-03-06  
**Versão**: 1.0

---

## Issue: wit-parser v0.219.1 is Yanked

### Manifesto do Problema

```
warning: package `wit-parser v0.219.1` in Cargo.lock is yanked in registry `crates-io`, 
consider running without --locked
```

### O que significa "Yanked"?

**"Yanked"** = Uma versão de um Rust crate foi **removida do registro** crates.io.

Razões comuns:

- ❌ Bug crítico descoberto
- ❌ Vulnerabilidade de segurança
- ❌ Release feito por engano
- ❌ Conflito de dependências

**Importante**: O código ainda funciona (está no git history), mas:

- ✅ Projetos existentes continuam usando
- ❌ Novos projetos NÃO conseguem instalar essa versão
- ⚠️ É sinal de que deve-se atualizar

### Por que está acontecendo?

`wit-parser v0.219.1` foi yanked, provavelmente porque:

1. Incompatibilidade com versões recentes de outras dependências
2. Bug em Component Model / WIT parsing
3. Versão supersede por v0.220+

### Devo me preocupar? ✅ TL;DR

**NÃO é bloqueador imediato**, mas:

| Situação | Ação |
|----------|------|
| Setup rodou com sucesso? | ✅ OK, continuar (é só warning) |
| Validação WASM / plugin falhar? | ⚠️ Volta aqui, investigar raiz |
| Quer estar "seguro"? | 🔧 Remova `--locked` e atualize |

---

## Solução: Atualizar para versão estável

### Opção 1: Quick Fix (Recomendado)

Remova o `--locked` do script de setup para permitir Cargo resolver para versão mais recente:

```powershell
# ANTES (em setup-rust-toolchain.ps1)
cargo install cargo-component --locked

# DEPOIS
cargo install cargo-component
```

**Benefício**: Cargo instala a última versão estável, sem yanked warnings.  
**Risco**: Extremamente baixo (cargo-component é bem mantido).

### Opção 2: Verificar manualmente

```bash
# Checar versão mais recente disponível
cargo search cargo-component

# Instalar versão específica (ex: latest stable)
cargo install cargo-component --version "^0.13"
```

### Opção 3: Ignorar por enquanto

Se a validação rodar bem, é seguro ignorar o warning.  
Solucionar antes de v0.1.0 release.

---

## Decisão Recomendada

### ✅ Ação imediata

1. **Testar se setup funcionou**:

   ```bash
   rustc --version
   cargo --version
   cargo-component --version
   wasm-tools --version
   ```

   Se todos comandos rodaram → ✅ Setup OK, warning é não-crítico

2. **Se quiser eliminar warning agora**:

   ```bash
   # Desinstalar versão yanked
   cargo uninstall cargo-component
   
   # Reinstalar sem --locked (ou com versão explícita)
   cargo install cargo-component
   ```

### 📋 Checklist de Documentação

- [ ] **Setup Scripts**: Remover `--locked` de:
  - `validations/setup-rust-toolchain.ps1`
  
- [ ] **roadmap**: Adicionar nota sobre dependências Rust

- [ ] **Pre-Sprint Checklist**: Marcar como "Investigado, não-bloqueador"

---

## Próximos Passos

### Se validação WASM funcionar perfeitamente

- Continue com SQLite benchmark
- Atualizar script quando tiver tempo

### Se encontrar problemas com WIT/WASM

- Volta aqui
- Investigar se é relacionado a wit-parser yanked
- Possível causa: versão nova quebrou compatibilidade

### Antes de v0.1.0 release

- Verificar: há atualizações de segurança?
- Documentar: versões pinadas para reprodutibilidade

---

## Referências

- [Cargo Lock Files](https://doc.rust-lang.org/cargo/guide/cargo-lock.html)
- [Crates.io Yank Policy](https://crates.io/)
- [wit-parser Releases](https://crates.io/crates/wit-parser)
- [cargo-component Releases](https://crates.io/crates/cargo-component)

---

## Status

| Item | Decisão | Owner |
|------|---------|-------|
| wit-parser yanked warning | Não-bloqueador, remover `--locked` opcionalmente | Setup script |
| Validação continua? | SIM, prosseguir | [QUICK_START.md](./QUICK_START.md) |
| Documentar? | SIM, neste arquivo | ✅ Done |
