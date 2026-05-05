# ADR-050: Exploração de Host Zig + Guest ClojureWasm para Ferramentas do Agente Pi

**Status**: Proposto (Exploração de Viabilidade)
**Date**: 2026-04-17
**Authors**: Arthur Aleksandro / Claude Code
**Related**: ADR-047 (Tractor Native Rust Host), ADR-048 (Tractor Graduation), ADR-049 (Post-Graduation Horizon)
**Vision**: [VISION_2026_AI_AGENT_SOVEREIGNTY.md](../../docs/proposals/VISION_2026_AI_AGENT_SOVEREIGNTY.md)

---

## Contexto

O `tractor` (ADR-047/048) é um host **Rust/wasmtime** graduado (~27 MB). A Visão 2026 projeta um Agente Soberano capaz de executar ferramentas instrumentadas localmente — análogo às 4 ferramentas atômicas do agente Pi: `read`, `write`, `edit`, `bash`.

Esta ADR explora se uma camada de host alternativa — **Zig como Runtime/Host**, **WASM/WASI como sandbox**, e **ClojureWasm/zwasm como lógica do agente** — oferece vantagens suficientes para justificar um novo artefato paralelo ao `tractor`, ou se deve ser tratada como shim/bridge sobre o host Rust existente.

### Tensão Central

| Aspecto | Host Rust (ADR-048, graduado) | Host Zig (proposto) |
|---------|-------------------------------|---------------------|
| Footprint | ~27 MB (wasmtime incluso) | ~1–5 MB (zig cc + zig-wasm) |
| Maturidade WASM | Produção (wasmtime 26+) | Inicial (wazm/zig-wasm em crescimento) |
| WIT Component Model | `cargo-component` + bindgen | Sem bindgen WIT nativo ainda |
| Ecossistema | `tokio`, `rusqlite`, `loro` | Mínimo — tudo a construir |
| Risco de divergência | Zero (já na base) | Alto — segunda implementação do protocolo |

---

## Decisão

**Não substituir o host Rust.** Definir o host Zig como uma **estratégia "Pi-Nano"**: um runtime ultra-leve para dispositivos com <4 MB disponíveis onde wasmtime não cabe, operando com contrato WIT compatível com `refarm-sdk.wit`.

O host Zig e o host Rust **compartilham o mesmo WIT** (`wit/refarm-sdk.wit`). Plugins compilados para o Component Model rodam nos dois sem recompilação.

---

## Decomposição: Ferramentas Pi → WIT/WASI

### Princípio Host vs. Guest

```
Host (Zig ou Rust)          │  Guest (ClojureWasm / qualquer WASM)
─────────────────────────────┼───────────────────────────────────────
IO, syscalls, segurança      │  Lógica, reflexão, processamento
Implementa wasi:*            │  Importa wasi:* via WIT
Controla capabilities        │  Declara capabilities no world
Sem lógica de negócio        │  Sem acesso direto ao OS
```

### Mapa de Ferramentas

| Ferramenta Pi | Reside no Host | Reside no Guest | Interface WASI/WIT |
|--------------|----------------|-----------------|---------------------|
| `read` | Abertura de fd, verificação de capability | Parsing, transformação do conteúdo | `wasi:filesystem/types@0.2.0` — `descriptor.read` |
| `write` | Write atômico (fsync), path resolution | Geração de conteúdo | `wasi:filesystem/types@0.2.0` — `descriptor.write` |
| `edit` | Aplicação de patch no fd | Geração de diff/patch (myers ou similar) | `wasi:filesystem` + `wasi:io/streams` |
| `bash` | Spawn de processo sandboxado, pipe IO | Construção de comando, parse de saída | `wasi:cli/command@0.2.0` (restrito por capability) |

### `bash` é o caso especial

A ferramenta `bash` é a única que requer spawn de processo no host. A abordagem segura:

```wit
// Proposta: agent-tool-contract-v1.wit
interface agent-shell {
  record shell-request {
    command: list<string>,       // argv sem interpolação de shell
    env-allowlist: list<string>, // variáveis permitidas
    cwd: option<string>,
    timeout-ms: u32,
  }

  record shell-result {
    stdout: list<u8>,
    stderr: list<u8>,
    exit-code: s32,
  }

  /// Executa apenas comandos pré-aprovados via TrustGrant.
  /// O host nega qualquer comando não declarado no manifesto do plugin.
  exec: func(req: shell-request) -> result<shell-result, string>;
}
```

O host **nunca executa `sh -c <string>`** — apenas `argv[]` com allowlist de capabilities declaradas no manifest do plugin.

---

## Estratégia de Bridge para ClojureWasm/zwasm

O zwasm (ClojureScript compilado para WASM via WasmGC) está em fase experimental. A estratégia de ponte:

```
Fase 1 (hoje)       → Plugin em Rust (cargo-component) expõe as 4 ferramentas
Fase 2 (zwasm ~α)   → ClojureScript compila para WASM via Babashka-wasm/zwasm,
                       importa as WIT interfaces como JavaScript FFI
Fase 3 (zwasm GA)   → Plugin ClojureWasm nativo importa wasi:filesystem diretamente
```

**Shim atual**: O guest ClojureWasm comunica via JSON sobre `wasi:io/streams` com um plugin Rust wrapper que já implementa o WIT completo. Zero bloqueio na Fase 1.

---

## Requisitos de Sistema para o Runtime Pi-Nano (Zig Host)

### SR-01 — Footprint
- Binary ≤ 5 MB (sem wasmtime; usar interpretador WASM minimal ou `wazm`)
- Zero dependência de libc dinâmica (musl estático)

### SR-02 — WIT Compatibility
- Implementar o mesmo `world refarm-plugin` de `wit/refarm-sdk.wit`
- Suportar `wasi:filesystem/types@0.2.0`, `wasi:logging/logging`, `wasi:io/streams`
- Protocolo WebSocket binário na porta 42000 (Loro frames — idêntico ao host Rust)

### SR-03 — Storage
- SQLite via `sqlite-zig` ou `zig-sqlite` com schema `PHYSICAL_SCHEMA_V1` idêntico
- `.db` portável entre host Rust e host Zig sem conversão

### SR-04 — Security
- `TrustManager` mínimo: SHA-256 do `.wasm` antes de qualquer instanciação
- Capability grants declarados no manifest; host nega silenciosamente acessos não declarados

### SR-05 — Sandboxing de bash
- Sem `sh -c`; apenas `argv[]` com allowlist
- Timeout obrigatório (`SIGKILL` após `timeout-ms`)
- Stdout/stderr capturados; sem herança de fd do host

---

## Consequências

### Positivas
- Host Zig abre deployment em dispositivos com <4 MB (microcontroladores, RISC-V bare-metal)
- WIT compartilhado garante que plugins escritos hoje rodam no futuro host Zig sem mudanças
- ClojureWasm como guest: reflexão/macros de Clojure para lógica do agente com semântica funcional pura

### Negativas / Riscos
- Zig host = segunda implementação do protocolo → risco de schema drift (mesmo problema evitado em ADR-049)
- zwasm sem WasmGC estável: Fase 1 obriga wrapper Rust, adicionando uma camada de tradução
- `wazm` (interpretador WASM em Zig) não implementa Component Model ainda — bloqueio para WIT direto

### Mitigações
- Schema drift: compartilhar `PHYSICAL_SCHEMA_V1` como arquivo SQL gerado em CI, testado nos dois hosts
- WasmGC: usar shim JSON-over-streams enquanto zwasm não suporta WIT nativo
- Component Model em Zig: contribuir ou aguardar `zig-wasm-component` (track ativo em bytecodealliance)

---

## Referências

- [ADR-047: Tractor Native Rust Host](ADR-047-tractor-native-rust-host.md)
- [ADR-048: Tractor Graduation](ADR-048-tractor-graduation.md)
- [ADR-049: Post-Graduation Horizon](ADR-049-post-graduation-horizon.md)
- [wit/refarm-sdk.wit](../../wit/refarm-sdk.wit)
- [VISION_2026_AI_AGENT_SOVEREIGNTY.md](../../docs/proposals/VISION_2026_AI_AGENT_SOVEREIGNTY.md)
- zwasm: https://github.com/babashka/babashka (track WASM)
- zig-wasm-component: https://github.com/bytecodealliance (track)
