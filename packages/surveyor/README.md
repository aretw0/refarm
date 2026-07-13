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

## Implementado hoje: layout force-directed headless (`@refarm.dev/surveyor`)

O primeiro núcleo real do Surveyor: a **física de layout** que posiciona os nós de um grafo em
2D, **sem DOM e sem framework** (uma camada de render — SVG no browser, canvas, ou um export de
imagem — consome as coordenadas). Portado fielmente do motor de grafo zero-dependência do
vault-seed (as constantes e fórmulas de repulsão/mola são as originais), extraído como bloco de
substrato reutilizável, tipado e **determinístico** (seed por hash do id, nunca `Math.random`) —
então um layout é reproduzível e testável em node.

```ts
import { layoutGraph } from "@refarm.dev/surveyor";

// {nodes: {id, degree?}, links: {source, target}} → nós posicionados {id, x, y, size, ...}
const placed = layoutGraph({
  nodes: [{ id: "a", degree: 2 }, { id: "b", degree: 1 }, { id: "c", degree: 1 }],
  links: [{ source: "a", target: "b" }, { source: "a", target: "c" }],
});
```

- `layoutGraph(graph, opts?)` — semeia (espiral golden-angle) + relaxa (N passos) → coordenadas.
- `seedLayout` / `relaxLayout` / `computeForces` — as peças puras, se a superfície quiser controlar
  a animação passo a passo (o loop RAF de um render interativo).
- `nodeSizeFromDegree` — o raio de um nó a partir do grau (um hub é maior).

Segue o **Headless-First**: aqui está a lógica de layout; um render 2D/3D é um consumidor.

## Especificações Iniciais (SDD)

### WIT Interface (`refarm-surveyor.wit`)

```wit
package plugin:surveyor@0.1.0;

interface types {
    use plugin:host/types.{json-ld-node, node-id};

    record graph-stats {
        node-count: u64,
        edge-count: u64,
        plugin-count: u32,
    }
}

interface mapper {
    use types.{graph-stats};
    use plugin:host/types.{json-ld-node, node-id, plugin-error};

    /// Obtém estatísticas gerais do grafo soberano.
    get-stats: func() -> result<graph-stats, plugin-error>;

    /// Busca nós por tipo (ex: "Person", "Message").
    query-by-type: func(schema-type: string) -> result<list<json-ld-node>, plugin-error>;

    /// Obtém as conexões (edges) de um nó específico.
    get-connections: func(id: node-id) -> result<list<node-id>, plugin-error>;
}

world surveyor {
    import plugin:host/tractor-bridge;
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
