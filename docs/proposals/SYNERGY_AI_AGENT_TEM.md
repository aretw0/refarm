# Synergy: AI Agent & TEM (The Cognitive Map)

A integração do **TEM (Tolman-Eichenbaum Machine)** com a visão de **AI Agent Sovereignty** não é apenas técnica, mas filosófica. O TEM fornece ao Agente a capacidade de **contextualização espacial e relacional** dentro do Grafo Soberano.

## 1. O Agente com "Intuição"
Enquanto LLMs tradicionais (como o Claude Code) são excelentes em manipulação de símbolos e código, eles frequentemente carecem de uma memória de longo prazo estruturada sobre a topologia específica do usuário.
- **Papel do TEM**: Atuar como o "Hipocampo" do Refarm. Ele mapeia as relações entre eventos, arquivos e intenções do usuário.
- **Sinergia**: O Agente pode consultar o TEM para entender se uma ação proposta é "novidade" (High Novelty) ou se segue o padrão estabelecido (Low Novelty), permitindo uma atuação muito mais precisa e menos disruptiva.

## 2. Active Inference em Escala
O projeto segue o framework de **Active Inference** (ver [AGENTS.md](../../AGENTS.md)). 
- **TEM como Modelo Generativo**: O TEM é um modelo preditivo por natureza. Ele prevê o "próximo estado" do sistema.
- **Sinergia**: Quando o Agente gera uma nova interface ou plugin, ele está essencialmente tentando reduzir o "Surprise" (Free Energy) do sistema. O TEM fornece a métrica matemática (`noveltyScore`) para validar se a nova ferramenta se encaixa no "mapa mental" do usuário.

## 3. Onboarding Dinâmico e Pesos de Treinamento
Na visão de 2026, o onboarding configura o Agente.
- **Sinergia**: O onboarding pode gerar um conjunto inicial de sequências sintéticas para o TEM. Isso significa que, ao terminar o checkout, o Agente já "nasce" com pesos pré-treinados que refletem a arquitetura desejada, eliminando o período de "frio" do aprendizado.

## 4. Evolução do Grafo de Capacidades
Atualmente, o vocabulário do TEM é fixo (16 ações).
- **Sinergia**: O Agente Soberano, ao criar novos plugins, pode **estender o vocabulário do TEM em runtime**. Isso criaria um ciclo de feedback onde o Agente cria a ferramenta e o TEM aprende a usá-la e a reconhecê-la como parte do "normal" do sistema.

## 5. Próximos Passos Técnicos
- **Inference Bridge**: Expor o `noveltyScore` e a `predictionConfidence` do TEM como primitivas no WIT do Refarm para que o Agente possa "sentir" o estado do sistema.
- **Continuous Retraining via Agent**: Permitir que o Agente dispare o pipeline de re-treinamento do TEM ao detectar mudanças estruturais significativas na forma como o usuário interage com o Refarm.

---
> "O TEM é o mapa; o Agente é o navegador. Sem o mapa, o Agente está perdido; sem o Agente, o mapa é apenas território estático."
