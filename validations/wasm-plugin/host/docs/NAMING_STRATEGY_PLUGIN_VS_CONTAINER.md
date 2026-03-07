# Naming Strategy: Plugin vs Container

## Pergunta

Devemos trocar a ideia de "plugin" por "container" (ex.: WebContainer)?

## Avaliacao de mercado

1. "Plugin/Extension" tem precedente forte.
- VS Code, Figma, Obsidian, navegadores.
- Usuario entende rapido: extensibilidade do produto.

2. "Container" comunica outro escopo.
- Espera de isolamento de processo, imagem, rede, filesystem e orquestracao.
- "WebContainer" remete a runtime Node completo no browser.

## Risco de renomear para container agora

- Cria expectativa tecnica maior do que o runtime atual entrega.
- Aumenta custo de comunicacao com time e usuarios.

## Recomendacao para Refarm

1. Externo (produto): manter "Plugin" ou evoluir para "Extension".
2. Interno (arquitetura): usar "runtime unit" ou "sandboxed module".
3. Longo prazo: avaliar "container-like runtime" como modo avancado, sem renomear todo o conceito atual.

## Frase de posicionamento sugerida

"Refarm executa extensoes (JS ou WASM) em runtimes isolados com capabilities explicitas."
