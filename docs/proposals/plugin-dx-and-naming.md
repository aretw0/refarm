# RFC: Plugin DX & Environment Architecture

## 1. Nomenclatura (Naming) e Natureza

Para manter a clareza arquitetural e o alinhamento com os padrões da indústria, os módulos estendíveis do sistema serão denominados de forma objetiva:

- **Plugins:** O termo principal e universal para módulos que estendem o Tractor.
- **Grafts (Enxertos):** Termo secundário/temático que pode ser utilizado em contextos educacionais ou metafóricos do *Sovereign Graph*, remetendo à ação de "enxertar" funcionalidades na árvore principal.

### Natureza Híbrida de Execução
É fundamental estabelecer que um Plugin no ecossistema Refarm **não é exclusivamente um módulo WASM**.
Enquanto o WASM (via WebAssembly Component Model e WIT) representa a solução segura e encapsulada (*sandboxed*) para plugins de terceiros ou de alto risco, a interface lógica (O Contrato) permanece agnóstica em relação ao motor de execução. O *Tractor* (Host) suportará:
1. **Plugins WASM:** Para execução segura de binários não confiáveis (Rust, Go, C, etc.).
2. **Plugins Nativos (ex: JS/TS direto):** Para plugins confiáveis de instâncias primárias ou cenários de altíssima performance em *Edge Workers*, onde a sobrecarga de um runtime WASM embutido não seja justificável.

## 2. Padronização de Logs e Telemetria (DX)

Os plugins que compilam para WASI expõem nativamente canais convencionais (`stdout` e `stderr`), que são interceptados pelo host. No entanto, o uso de texto puro em `stdout` resulta na perda de semântica de criticidade e rastreabilidade estruturada.

**Proposta Arquitetural (Host Calls):**
O sistema deve definir uma interface padronizada no contrato WIT (ex: `refarm:environment/logger`) para garantir o tráfego de metadados:

```wit
interface logger {
    enum level { debug, info, warn, error }
    log: func(lvl: level, msg: string)
}
```

**Benefícios da Abordagem Integrada:**
- **Developer Experience (DX) Cativante:** Qualquer linguagem suportada pelo Component Model (Rust, TypeScript, Go, Python) terá os *bindings* (SDKs) gerados automaticamente. Ao executar `logger.log(warn, "msg")`, a semântica é preservada.
- **Enriquecimento pelo Host:** O *Tractor* recebe a chamada estruturada, aplica o carimbo de tempo (timestamp exato) e o identificador do plugin (metadados de origem).
- **Roteamento Inteligente:** O Host pode rotear esse log processado para o DevTools (com formatação de cores adequada) ou transmiti-lo para um agregador de telemetria externo, dependendo do ambiente em que o Kernel está operando.

## 3. Consciência de Ambiente (Environment Capabilities)

Plugins complexos requerem estratégias de fallback dependendo do contexto físico de onde estão sendo executados. Utilizar Enumerações estáticas para definir o alvo (como `browser`, `edge`, `desktop`) é arquiteturalmente frágil.

**A Solução: Classes de Runners e Capabilities Dinâmicas**
O sistema abolirá alvos estáticos em favor de um mapa dinâmico de *Capabilities* (Capacidades) acoplado a uma *Runner Class*. O plugin passa a investigar o host de forma explícita.

**Proposta de Interface WIT:**

```wit
interface runtime {
    /// Identifica a categoria matriz do ambiente (ex: 'web-browser', 'edge-worker', 'local-daemon', 'cloud-server')
    runner-class: func() -> string
    
    /// O plugin consulta ativamente o host sobre a disponibilidade de uma feature de hardare/software
    /// Ex: has-capability("gpu-inference") -> bool
    /// Ex: has-capability("fs-persistent") -> bool
    has-capability: func(cap: string) -> bool
}
```

**Casos de Uso Previstos:**
- Um ecossistema expansível onde novos "hosts" exóticos futuros (ex: dispositivos embarcados locais) são suportados imediatamente.
- Consciência Preditiva: Se um plugin de processamento identifica que a `runner-class()` é um `edge-worker`, ele infere restrições severas de memória/CPU e pode abortar o carregamento de grandes modelos de IA.
- Agressividade Segura: Se `has-capability("local-sqlite")` for verdadeiro, o plugin pode otimizar suas queries para persistência transacional síncrona, caso contrário faz downgrade para indexação efêmera.
