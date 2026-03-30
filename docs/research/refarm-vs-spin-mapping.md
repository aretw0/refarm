# Mapeamento Arquitetural: Refarm vs. Spin v3

Este documento mapeia os conceitos do **Spin v3** para as entidades já existentes ou planejadas no **Refarm**, demonstrando que a arquitetura do microkernel `tractor` e o ecossistema de plugins já cobrem as necessidades fundamentais sem a necessidade de um pivotamento.

## Tabela de Equivalência

| Conceito Spin v3 | Conceito Refarm | Status no Refarm | Observação Técnica |
| :--- | :--- | :--- | :--- |
| **Spin Factors** | **Microkernel Plugins (Tractor)** | ✅ Implementado | O `tractor` já opera como um host que carrega capacidades via plugins. O que o Spin chama de "Factors" nós chamamos de plugins de infraestrutura. |
| **Component Dependencies** | **Plugin Composition (WIT)** | 🚧 Em progresso | Ambos utilizam o *WebAssembly Component Model*. A "dependência" no Refarm é resolvida via interfaces WIT compartilhadas. |
| **Selective Deployment** | **Stratification (Distros)** | ✅ Implementado | O Refarm usa "Distros" (ex: `apps/me` vs `apps/dev`) para selecionar quais plugins rodam em qual contexto. |
| **Host Components** | **Tractor Syscalls** | ✅ Implementado | As funcionalidades base do host (armazenamento, cripto) são expostas via syscalls agnósticas no `tractor`. |
| **Spin Up / CLI** | **Refarm CLI / Barn** | ✅ Implementado | O `refarm` CLI e o plugin `Barn` gerenciam o ciclo de vida e a execução, similar ao `spin up`. |
| **Variable/Config Factor** | **Silo / Config** | ✅ Implementado | O provisionamento de segredos e contextos é responsabilidade do `Silo` e `Config`. |
| **HTTP/2 & gRPC** | **Plugin-Courier (Antenna)** | 🚧 Evoluindo | O `Courier` é o nosso "Broadcast", abstraindo os protocolos de saída e materialização de dados. |

## Análise do Plugin-Courier (O Carteiro)

O **Plugin-Courier** (também chamado de **Antenna**) é a peça central para a comunicação externa no Refarm. 
- **Defesa**: Enquanto o Spin foca em ser um servidor HTTP para microserviços, o Courier foca em **Broadcast Soberano**. 
- **Similaridade**: O suporte do Spin a HTTP/2 e gRPC é uma evolução de transporte. O Courier pode adotar esses protocolos internamente para melhorar a performance de materialização de nós do grafo, sem mudar sua identidade de "Antena" do sistema.
- **Conclusão**: Não há falha essencial. O Courier já abstrai a materialização de dados (JSON-LD para HTML/URL). A evolução para protocolos mais modernos é uma melhoria de infraestrutura, não de arquitetura.

## Conclusão da Análise de Risco

Não detectamos nenhuma falha estrutural no microkernel que exija um pivotamento. A aposta na **Arquitetura de Plugins** desde o dia 1 coloca o Refarm em uma posição de vantagem:
1.  **Nomes Diferentes, Mesmos Conceitos**: "Factors" são apenas uma forma mais granular de organizar o que já fazemos com plugins de host.
2.  **Abstração de Protocolos**: O Courier é o lugar correto para a lógica de comunicação. Ele protege o resto do sistema de mudanças nos protocolos de rede.
3.  **Convergência Natural**: A convergência com o Spin deve ser feita no nível de **Interfaces (WIT)**. Se usarmos as mesmas interfaces (ex: `wasi:key-value`), nossos plugins poderão rodar em hosts Spin e vice-versa, sem que tenhamos que mudar nossa arquitetura interna.
