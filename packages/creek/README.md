# 🌊 Creek (O Riacho)

> The Telemetry Stream for the Refarm ecosystem — real-time pulse and event monitoring.

---

## O que é o Creek?

O **Creek (O Riacho)** é o plugin responsável pela telemetria e monitoramento em tempo real dos pulsos e eventos que fluem pelo ecossistema Refarm. Se o Tractor é o motor, o Creek é o painel de instrumentos que mostra a saúde e o fluxo de dados em tempo real.

O Creek é **Headless-First**, focado em capturar e emitir fluxos de eventos (`streams`) para componentes de monitoramento especializados.

## Responsabilidades Core

- 🌊 **Stream de Eventos**: Captura todos os eventos do barramento de telemetria do Tractor (TelemetryBus).
- 💓 **Monitoramento de Pulso**: Fornece métricas de performance (CPU, memória, latência de plugins).
- 📜 **Log Aggregation**: Agrega logs de todos os plugins ativos em um fluxo unificado e filtrável.
- 🚦 **Alertas de Saúde**: Identifica e sinaliza erros em plugins ou falhas de sincronização em tempo real.

## Especificações Iniciais (SDD)

### WIT Interface (`refarm-creek.wit`)

```wit
package refarm:creek@0.1.0;

interface types {
    use refarm:plugin/types.{json-ld-node, node-id};

    record pulse-event {
        timestamp: u64,
        source: string, // plugin-id ou "kernel"
        level: string,  // "info", "warn", "error"
        message: string,
        payload: string, // JSON-LD payload opcional
    }

    record system-health {
        uptime: u64,
        active-plugins: u32,
        event-throughput: f64, // eventos por segundo
    }
}

interface monitor {
    use types.{pulse-event, system-health};
    use refarm:plugin/types.{plugin-error};

    /// Obtém a saúde atual do sistema.
    get-health: func() -> result<system-health, plugin-error>;

    /// Inscreve-se em um fluxo de eventos filtrado.
    subscribe: func(filter: string) -> result<u32, plugin-error>; // Retorna ID da subscrição

    /// Lê os últimos eventos do buffer.
    read-buffer: func(limit: u32) -> result<list<pulse-event>, plugin-error>;
}

world creek {
    import refarm:plugin/tractor-bridge;
    export monitor;
}
```

## Roadmap v0.1.0

- [ ] Spec: Definição do TelemetryBus WIT e interface de Monitoramento.
- [ ] BDD: Testes de integração para visualização de logs em tempo real no Studio.
- [ ] TDD: Implementação do buffer circular de eventos em Rust/WASM.
- [ ] DDD: Integração com o barramento de eventos nativo do Tractor.

## Licença

[AGPL-3.0-only](../../LICENSE)
