# Proposta: Plugin DX, Naming & Environment

## 1. Nomenclatura (Naming) e Natureza

Embora tenhamos discutido nomes temáticos como *Implements* (Implementos) ou *Seeds* (Sementes), a clareza para o desenvolvedor final muitas vezes vence. Portanto, operaremos com:

- **Plugins** (O padrão ouro universal)
- **Grafts (Enxertos):** Se quisermos um apelido temático sutil no futuro, Grafts se conecta bem à ideia de enxertar funcionalidades num "tronco" (o Grafo).

**Importante:** Um Plugin no Refarm **não é exclusivamente WASM**.
Enquanto o WASM (Component Model via WIT) é a nossa tecnologia "Sandboxed" para plugins de terceiros e de alto risco, o Tractor (Host) também suportará Plugins "Nativos" (como funções JS diretas) para o núcleo confiável, ou para cenários Edge onde rodar uma Cloudflare Worker em JS puro é melhor. A interface lógica (Contrato) é a mesma, mas a execução pode variar.

## 2. Padronização de Logs (DX)

Os plugins (feitos em Rust, Go, TS) já têm `stdout` e `stderr` naturais via WASI. O host (Tractor) intercepta isso hoje.
Porém, "texto puro" no `stdout` perde semântica.

**A Solução DX:**
Devemos definir uma interface no arquivo WIT (ex: `refarm:environment/logger`) que expõe:

```wit
interface logger {
    enum level { debug, info, warn, error }
    log: func(lvl: level, msg: string)
}
```

**Por que?** Porque assim, quando um plugin chama `logger.log(warn, "Demorou muito")`, o Tractor (Host) recebe isso de forma estruturada.
Isso destrava a melhor *Developer Experience (DX)* **para qualquer linguagem que compile para WASM** (Rust, TypeScript/Javy, Go, Python, etc.), não apenas Rust. O WIT gera os bindings (SDKs) automaticamente para a linguagem alvo do desenvolvedor daquele Plugin. O Host (Refarm) recebe, injeta metadados (timestamp, autor) e roteia para o console do DevTools (com cores) ou para a telemetria do servidor.

## 3. Consciência de Ambiente (Environment Awareness)

Você levantou um ponto crucial: um "enum" estático de ambientes (`browser`, `edge`, etc.) é frágil.
E o Desktop? O "Desktop" na arquitetura "Local First" significa um *Local Runner* (Tauri, Electron, Deno rodando local).

**A Solução: Classes de Runners e Capabilities Dinâmicas**
Em vez de um alvo engessado, devemos fornecer um mapa de *Capabilities* (Capacidades) e *Classes de Runner*. O plugin diz "eu quero usar isso", e o host diz "nesse host, eu tenho ou não tenho recurso X".

**Exemplo de Interface:**

```wit
interface runtime {
    /// Pode ser 'web-browser', 'edge-worker', 'local-daemon' (desktop/cli), 'cloud-server'
    runner-class: func() -> string
    
    /// O plugin pergunta se o ambiente atual tem certa capacidade
    /// Ex: has-capability("gpu-inference") -> bool
    /// Ex: has-capability("fs-persistent") -> bool
    has-capability: func(cap: string) -> bool
}
```

Isso cria um ecossistema natural onde novos tipos de "hosts" podem surgir no futuro. Se um plugin sabe que o `runner-class()` é `edge-worker`, ele já sabe que tem restrições de memória de CPU e talvez decida não importar um modelo grande. Se ele chama `has-capability("local-sqlite")` e recebe `true`, ele já sabe que pode abusar do DB.
