# Estratégia de Dependências do Turborepo no Refarm

Este documento visa esclarecer o uso das dependências de tarefas no `turbo.json` do monorepo Refarm, especificamente a diferença entre `"dependsOn": ["^task"]` e `"dependsOn": ["task"]`. Compreender essa distinção é fundamental para otimizar os tempos de build e garantir a eficiência do pipeline de CI/CD.

## `dependsOn`: Controlando o Grafo de Tarefas

No Turborepo, a propriedade `dependsOn` dentro da configuração de uma tarefa (`tasks`) define quais tarefas devem ser executadas antes da tarefa atual. O Turborepo constrói um grafo de dependências com base nessas configurações.

### 1. `"dependsOn": ["^task"]` (Dependência de Grafo Completo)

*   **Significado**: Quando você usa o prefixo `^` (caret) antes do nome de uma tarefa (ex: `^build`), o Turborepo entende que a tarefa atual depende da execução da `task` **em todas as dependências do pacote atual no grafo do monorepo**. Isso significa que, antes de executar a `task` no pacote atual, o Turborepo garantirá que a `task` tenha sido executada (ou recuperada do cache) em todos os pacotes dos quais o pacote atual depende.
*   **Quando Usar**: Utilize `^task` quando a tarefa atual **realmente precisa dos artefatos ou do estado de todas as suas dependências**. Exemplos comuns incluem:
    *   **`build`**: Um pacote geralmente precisa que suas dependências sejam construídas antes que ele próprio possa ser construído. `"dependsOn": ["^build"]` é o padrão e geralmente correto para a tarefa `build`.
    *   **`lint` ou `type-check` em um pacote que exporta tipos**: Se um pacote `A` exporta tipos que são consumidos por um pacote `B`, e `B` executa `type-check`, então `B` precisa que `A` tenha seus tipos gerados (parte do `build` de `A`). Neste caso, `^build` para `type-check` em `B` faz sentido.
*   **Implicações**: O uso de `^task` pode levar a builds em cascata de muitos pacotes, mesmo que apenas um pacote específico esteja sendo trabalhado. Se o cache do Turborepo não estiver configurado corretamente ou estiver vazio, isso pode resultar em tempos de execução longos.

### 2. `"dependsOn": ["task"]` (Dependência Local/Direta)

*   **Significado**: Quando você usa apenas o nome da tarefa (ex: `build`), o Turborepo entende que a tarefa atual depende da execução da `task` **apenas no próprio pacote atual**. Ele não força a execução da `task` nas dependências do pacote no grafo do monorepo.
*   **Quando Usar**: Utilize `task` (sem o `^`) quando a tarefa atual **não precisa que suas dependências sejam processadas pelo Turborepo antes de sua própria execução**, ou quando a tarefa já inclui a lógica para lidar com suas dependências internamente. Exemplos comuns incluem:
    *   **`test:e2e`**: Testes E2E geralmente iniciam um servidor de desenvolvimento ou build que já se encarrega de construir o projeto. Forçar um `^build` em todas as dependências antes de iniciar o servidor E2E é redundante e ineficiente. A tarefa `build` do próprio pacote E2E já deve ser suficiente para preparar o ambiente.
    *   **`lint` ou `type-check` para pacotes independentes**: Se um pacote não tem dependências que afetam diretamente seu linting ou verificação de tipos, ou se essas verificações são independentes do estado de build das dependências, usar `lint` ou `type-check` (sem `^`) pode ser mais rápido.
*   **Implicações**: Reduz significativamente o número de tarefas executadas pelo Turborepo, resultando em tempos de execução mais rápidos, especialmente em CI/CD. No entanto, exige que a tarefa local (`build`, `dev`, etc.) do pacote seja robusta o suficiente para lidar com suas próprias dependências ou que as dependências já estejam em um estado construído/pronto.

## Recomendações para o Refarm

No contexto do monorepo Refarm, a estratégia deve ser:

1.  **`build`**: Manter `"dependsOn": ["^build"]` para a tarefa `build` principal, pois a construção de um pacote geralmente requer que suas dependências estejam construídas.
2.  **`test:e2e`**: Alterar para `"dependsOn": ["build"]`. Os testes E2E devem depender apenas do `build` do próprio pacote de teste, que por sua vez deve ser capaz de iniciar o ambiente necessário (incluindo a construção de suas dependências diretas, se aplicável, ou confiando em artefatos já construídos).
3.  **`test`, `test:coverage`, `test:unit`, `test:integration`**: Alterar para `"dependsOn": ["build"]`. Similar aos E2E, a maioria dos testes unitários e de integração pode depender apenas do `build` do próprio pacote, que deve ser suficiente para compilar o código a ser testado.
4.  **`lint` e `type-check`**: Avaliar caso a caso. Se um pacote `A` exporta tipos que são cruciais para o `type-check` de `B`, então `"dependsOn": ["^build"]` em `type-check` de `B` pode ser necessário. No entanto, se o `type-check` de um pacote é autocontido ou se os tipos já são gerados como parte do `build` local, `"dependsOn": ["build"]` é preferível.

### Exemplo de Otimização no `turbo.json`

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", ".env*"],
      "outputs": ["dist/**", ".astro/**", "pkg/**", "target/**"]
    },
    "lint": {
      "dependsOn": ["build"] // Alterado de ^build para build
    },
    "test": {
      "dependsOn": ["build"], // Alterado de ^build para build
      "inputs": [
        "src/**",
        "test/**",
        "tests/**",
        "*.config.*",
        "**/*.rs",
        "Cargo.toml",
        "Cargo.lock"
      ]
    },
    "test:e2e": {
      "dependsOn": ["build"], // Alterado de ^build para build
      "inputs": [
        "src/**",
        "test/**",
        "tests/**",
        "*.config.*",
        "playwright.config.*",
        "public/**" 
      ],
      "outputs": ["test-results/**"]
    },
    "type-check": {
      "dependsOn": ["build"] // Alterado de ^build para build
    }
  }
}
```

Ao aplicar essa estratégia, o monorepo Refarm se beneficiará de um pipeline de CI/CD mais rápido e eficiente, minimizando builds desnecessários e maximizando o uso do cache do Turborepo.
