# 🗺️ Surveyor (O Agrimensor)

> The Graph Mapper for the Refarm ecosystem — visualizing and navigating the Sovereign Graph.

---

## O que é o Surveyor?

O **Surveyor (O Agrimensor)** é o plugin responsável por mapear e visualizar o **Sovereign Graph**. Ele permite que o usuário entenda as conexões entre seus dados, identidades e plugins, fornecendo uma interface de navegação semântica.

Seguindo a filosofia **Headless-First**, o Surveyor foca na lógica de travessia do grafo e na provisão de dados para componentes de UI especializados.

## Responsabilidades Core

- 🗺️ **Mapeamento de Grafo**: Transforma os nós JSON-LD armazenados no SQLite em uma estrutura de grafo navegável.
- 🔍 **Descoberta Semântica**: Permite consultas complexas baseadas em tipos de esquema (ex: "Encontre todos os `Person` relacionados ao plugin `matrix-bridge`").
- 🔌 **Visualização de Plugins**: Mapeia como os plugins estão conectados e quais dados eles estão gerando ou consumindo.
- 📊 **Provedor de Dados**: Fornece os dados para o `apps/dev/graph.astro` e outras interfaces 2D/3D.

## Especificações Iniciais (SDD)

### WIT Interface (`refarm-surveyor.wit`)

```wit
package refarm:surveyor@0.1.0;

interface types {
    use refarm:plugin/types.{json-ld-node, node-id};

    record graph-stats {
        node-count: u64,
        edge-count: u64,
        plugin-count: u32,
    }
}

interface mapper {
    use types.{graph-stats};
    use refarm:plugin/types.{json-ld-node, node-id, plugin-error};

    /// Obtém estatísticas gerais do grafo soberano.
    get-stats: func() -> result<graph-stats, plugin-error>;

    /// Busca nós por tipo (ex: "Person", "Message").
    query-by-type: func(schema-type: string) -> result<list<json-ld-node>, plugin-error>;

    /// Obtém as conexões (edges) de um nó específico.
    get-connections: func(id: node-id) -> result<list<node-id>, plugin-error>;
}

world surveyor {
    import refarm:plugin/tractor-bridge;
    export mapper;
}
```

## Roadmap v0.1.0

- [ ] Spec: Definição completa do WIT e Esquema de Consulta.
- [ ] BDD: Testes de integração para travessia de grafo no Studio.
- [ ] TDD: Implementação da lógica de mapeamento em TypeScript/WASM.
- [ ] DDD: Integração com o Tractor para consultas diretas ao SQLite.

## Licença

[AGPL-3.0-only](../../LICENSE)
