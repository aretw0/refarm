# Rust + WASM Setup Issues - Diagnostic & Solutions

**Data**: 2026-03-06  
**Status**: Documento de suporte para validações Refarm  
**Baseado em**: Pesquisa oficial Rust, wit-bindgen, cargo-component

---

## 🔴 Erro 1: `wasm32-wasi` não suportado

### Manifesto

```
error: toolchain 'stable-x86_64-pc-windows-msvc' does not support target 'wasm32-wasi'; 
did you mean 'wasm32-wasip1'?
```

### Raiz do Problema

**A mudança é REAL e recente:**

- `wasm32-wasi` era o target histórico para WebAssembly System Interface
- Em **2024**, quando o WASM Component Model foi padronizado, Rust renomeou para `wasm32-wasip1`
- **wasip1** = WASI Preview 1 (a versão anterior do WASI, predecessora do Component Model)

**Timeline:**

- 2022-2023: `wasm32-wasi` era padrão
- 2024: `wasm32-wasip1` é o replacement (veja [cargo-component PR #313](https://github.com/bytecodealliance/cargo-component/commits))
- 2024 (Rust 1.82+): `wasm32-wasip2` adicionado como tier 2 (WASI 0.2 / Component Model nativo)

### Solução para Refarm

**Opção A: Usar `wasm32-wasip1` (recomendado para agora)**

```bash
# Em setup-rust-toolchain.ps1, substituir:
rustup target add wasm32-wasi

# POR:
rustup target add wasm32-wasip1
```

**Por quê**: cargo-component ainda usa `wasm32-wasip1` como padrão. Totalmente suportado.

**Opção B: Usar `wasm32-wasip2` (futuro-proof, 2025+)**

```bash
rustup target add wasm32-wasip2
```

Requer `cargo-component` ≥ 0.14 e Rust ≥ 1.82.  
Mais próximo do Component Model v1.0, menos polyfills necessários.

**Opção C: Usar `wasm32-unknown-unknown` (mais simples, sem WASI)**

```bash
rustup target add wasm32-unknown-unknown
```

Se seu plugin NÃO precisa de I/O/syscalls WASI (puro cálculo).  
Melhor para plugins leves (armazenamento sempre localizado no host).

### Recomendação para Refarm

| Tipo de Plugin | Target | Razão |
|---|---|---|
| Genérico (puro processamento) | `wasm32-unknown-unknown` | Smaller binary, zero WASI overhead |
| Com I/O file system | `wasm32-wasip1` | cargo-component padrão atual |
| Futuro 2025+ | `wasm32-wasip2` | Native Component Model v1.0 support |

**Para agora (validação)**: Use **`wasm32-wasip1`** — bom compromisso, bem suportado.

---

## 🔴 Erro 2: `link.exe` não encontrado

### Manifesto

```
error: linker `link.exe` not found
note: the msvc targets depend on the msvc linker but `link.exe` was not found
note: please ensure that Visual Studio 2017 or later, or Build Tools for Visual Studio 
      were installed with the Visual C++ option.
```

### Raiz do Problema

**Rust no Windows MSVC requer linker nativo:**

- Rust compila para bytecode
- **Mas precisa linkagem com bibliotecas do sistema Windows**
- Isso requer `link.exe` (MSVC linker) + C++ runtime libraries
- **VS Code não inclui isso** — é apenas um editor de texto
- **Visual Studio 2022** ou **Visual Studio Build Tools** precisa estar instalado

### Arquitetura Técnica

```
┌─────────────────┐
│  Rust source    │
└────────┬────────┘
         │ rustc (Rust compiler)
         ▼
┌─────────────────┐
│  Object files   │  (.obj, intermediate)
└────────┬────────┘
         │ link.exe (MSVC linker) ← VEM DAQUI
         ▼
┌──────────────────────┐
│  Executable binary   │  (.exe, .dll)
└──────────────────────┘
```

### Solução

**Opção A: Instalar Visual Studio Build Tools (recomendado)**

1. Baixar: <https://visualstudio.microsoft.com/visual-cpp-build-tools/>
2. Instalar com: **"Desktop development with C++"** workload ✅
3. **Restart PowerShell** (nova sessão precisa do novo PATH)

**Verificar**:

```powershell
rustc --version
rustc --print=cfg | findstr msvc  # Deve mostrar target_env="msvc"
```

**Opção B: Mudar para target GNU (alternativa)**

```bash
rustup target add x86_64-pc-windows-gnu
```

Daí compilar com:

```bash
cargo build --target x86_64-pc-windows-gnu
```

**Trade-off**: GNU usa MinGW linker (menor integração Windows). Menos recomendado.

**Opção C: Usar WSL2 / Linux (workaround)**

Se não conseguir instalar Build Tools, rodar Rust em WSL2 (Windows Subsystem for Linux).

```bash
wsl --install  # Instala WSL2
rustup target add wasm32-wasip1  # Dentro do WSL
```

**Trade-off**: Complexidade extra, mas funciona perfeitamente para WASM.

### Recomendação para Refarm

**Instale Visual Studio Build Tools com C++ (Opção A).**

Razão:

- WASM precisa ligação com runtime C++
- Build Tools é componente oficial Microsoft
- Certificado e mantido
- Usado por comunidade Rust Windows

**Tempo**: ~30 min instalar + restart

---

## 🔴 Erro 3: `cargo-component` / `wasm-tools` não no PATH

### Manifesto

```
The term 'cargo-component' is not recognized as a name of a cmdlet, function, script file, 
or executable program.
```

### Raiz do Problema

**`cargo install` coloca binários em `~/.cargo/bin/`**

Windows PowerShell às vezes não reconhece esse diretório no PATH automaticamente.

**Verificação**:

```powershell
echo $env:Path -split ";"  # Ver todos paths
Get-Command cargo-component  # Verificar se reconhece
```

### Solução (3 opções)

#### Opção A: Verificar se PATH foi atualizado

```powershell
# Terminal EM NOVA SESSÃO PowerShell (fecha e abre de novo)
cargo-component --version
wasm-tools --version
```

Às vezes precisa só restart.

#### Opção B: Adicionar `~/.cargo/bin` ao PATH permanentemente

```powershell
# EXECUTAR COMO ADMINISTRADOR
[Environment]::SetEnvironmentVariable(
  "PATH",
  "$env:PATH;$env:USERPROFILE\.cargo\bin",
  [System.EnvironmentVariableTarget]::User
)
```

Depois **fechar e abrir PowerShell novamente**.

#### Opção C: Usar full path temporariamente

```powershell
& "$env:USERPROFILE\.cargo\bin\cargo-component.exe" --version
```

### Verificação de Setup Completo

```powershell
# Testar TODAS as ferramentas
rustc --version
cargo --version
& "$env:USERPROFILE\.cargo\bin\cargo-component.exe" --version
& "$env:USERPROFILE\.cargo\bin\wasm-tools.exe" --version
```

Se algum falhar, voltou a Error 2 (link.exe).

---

## 📋 Checklist de Troubleshooting

### Antes de começar

- [ ] Windows 10 ou 11 com PowerShell 7+
- [ ] ~15 GB de espaço em disco (Rust + MSVC Build Tools)
- [ ] Conexão com internet (downloads grandes)

### Se Error 1 (wasm32-wasi)

```bash
rustup target add wasm32-wasip1    # ← Fix
cargo component build --release
```

### Se Error 2 (link.exe)

```
❌ BLOQUEADOR → Instale Visual Studio Build Tools
1. Baixar: https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. Escolher: "Desktop development with C++"
3. Reiniciar PowerShell
4. Retry cargo install
```

### Se Error 3 (PATH)

```powershell
# Test 1: Nova sessão PowerShell
cargo-component --version

# Test 2: Se erro, adicionar PATH (como admin)
[Environment]::SetEnvironmentVariable(
  "PATH",
  "$env:PATH;$env:USERPROFILE\.cargo\bin",
  [System.EnvironmentVariableTarget]::User
)

# Fechar e abrir PowerShell novamente
```

---

## 📊 Decisão de Targets para Refarm

### Para validação (agora)
→ **`wasm32-wasip1`** (cargo-component padrão, bem suportado)

### Para v0.1.0
→ Revise se prefere:

- `wasm32-unknown-unknown` (simples, sem WASI)
- `wasm32-wasip1` (com I/O, mais features)
- `wasm32-wasip2` (quando Rust 1.82+ for padrão)

**Recomendação**: Comece com `unknown-unknown` (plugins genéricos), migre para `wasip1` se precisar I/O.

### Se user não conseguir instalar Build Tools
→ Use **WSL2** (fallback completo, funciona 100%)

---

## Referências Oficiais

| Recurso | Link | Nota |
|---------|------|------|
| rustup Windows MSVC | <https://rust-lang.github.io/rustup/installation/windows-msvc.html> | Oficial, detalha MSVC req |
| Visual Studio Build Tools | <https://visualstudio.microsoft.com/visual-cpp-build-tools/> | Download direto |
| cargo-component GitHub | <https://github.com/bytecodealliance/cargo-component> | Issues, PRs sobre targets |
| wit-bindgen docs | <https://github.com/bytecodealliance/wit-bindgen> | Component Model reference |
| Rust Blog - wasip2 | <https://blog.rust-lang.org/2024/11/26/wasip2-tier-2.html> | Annot novo tier 2 target |
| WASI Specification | <https://wasi.dev/> | Official WASI spec |

---

## Status: Mapeado

| Erro | Classificação | Solução | Bloqueador? |
|------|---|---|---|
| wasm32-wasi → wasip1 | Expected (mudança 2024) | Usar `wasm32-wasip1` | ❌ NÃO |
| link.exe missing | Dependência sistema | Instalar Build Tools | ✅ **SIM** |
| PATH não reconhece | Variável ambiente | Restart ou adicionar PATH | ❌ NÃO |

**Próximo passo**: Atualizar `setup-rust-toolchain.ps1` com fixes e documentação.
