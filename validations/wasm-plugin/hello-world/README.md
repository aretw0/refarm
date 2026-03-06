# Hello World Plugin - Validação WASM + WIT

Plugin minimalista para validar que o WASM Component Model funciona no Refarm.

## Prerequisites

- Rust 1.70+ via `rustup`
- `cargo-component` instalado via `cargo install cargo-component`
- Visual C++ Build Tools (Windows) — veja [RUST_WINDOWS_TROUBLESHOOTING.md](../RUST_WINDOWS_TROUBLESHOOTING.md)

## Build

### Opção 1: Genérico (recomendado para começar)

```bash
# Usa wasm32-unknown-unknown (não precisa de WASI)
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release
```

Output: `target/wasm32-unknown-unknown/release/hello_world_plugin.wasm`

### Opção 2: Com WASI Preview 1 (cargo-component)

```bash
# Usa wasm32-wasip1 (WASI Preview 1)
rustup target add wasm32-wasip1
cargo component build --release
```

Output: `target/wasm32-wasip1/release/hello_world_plugin.wasm`

**Nota**: Se receber erro `wasm32-wasi not supported`, leia [RUST_WINDOWS_TROUBLESHOOTING.md - Error 1](../RUST_WINDOWS_TROUBLESHOOTING.md#-erro-1-wasm32-wasi-não-suportado).

## Inspecionar WASM Component

```bash
wasm-tools component wit target/wasm32-wasip1/release/hello_world_plugin.wasm
```

Esperado: Interface WIT visível (setup, ingest, push, teardown, metadata).

## Troubleshooting

| Erro | Solução | Link |
|------|---------|------|
| `wasm32-wasi not supported` | Use `wasm32-wasip1` (2024 rename) | [Error 1](../RUST_WINDOWS_TROUBLESHOOTING.md#-erro-1-wasm32-wasi-não-suportado) |
| `link.exe not found` | Instale Visual Studio Build Tools | [Error 2](../RUST_WINDOWS_TROUBLESHOOTING.md#-erro-2-linkexe-não-encontrado) |
| `cargo-component: command not found` | Feche e abra PowerShell novo | [Error 3](../RUST_WINDOWS_TROUBLESHOOTING.md#-erro-3-cargo-component--wasm-tools-não-no-path) |

## Próximo Passo

Carregar este `.wasm` no browser usando o host TypeScript em `../host/`.
