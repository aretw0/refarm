# Infraestrutura TypeScript no Refarm

Este documento esclarece a arquitetura da configuração TypeScript no monorepo Refarm, detalhando a função do `tsconfig.json` da raiz e do pacote `@refarm.dev/tsconfig`.

---

## 1. O `tsconfig.json` da Raiz (Global)

O arquivo `tsconfig.json` localizado na raiz do monorepo (`/tsconfig.json`) serve como a **configuração TypeScript global e unificada** para todo o projeto. Ele define as opções de compilador que são comuns e essenciais para todos os pacotes TypeScript, garantindo consistência e interoperabilidade.

### Propósito Principal:

*   **Configurações Comuns**: Define `compilerOptions` como `target`, `module`, `strict`, `esModuleInterop`, `skipLibCheck`, etc., que devem ser aplicadas a todos os projetos TypeScript no monorepo.
*   **Mapeamento de Caminhos (`paths`)**: É o local central onde os aliases de módulos são definidos. Isso permite que os pacotes importem outros pacotes do monorepo usando nomes curtos e consistentes (ex: `@refarm.dev/tractor`) em vez de caminhos relativos complexos (`../../packages/tractor-ts/src`). Isso é crucial para a experiência de desenvolvimento (VS Code) e para a resolução de módulos em tempo de compilação.
*   **Exclusões Globais**: Define diretórios e arquivos que devem ser excluídos da compilação em todo o monorepo (ex: `node_modules`, `dist`, `build`).

### Exemplo de `paths`:

```json
// tsconfig.json (raiz)
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@refarm.dev/tractor": ["./packages/tractor-ts/src/index.ts"],
      "@refarm.dev/barn": ["./packages/barn/src/index.ts"],
      "@refarm.dev/tractor/test/test-utils": ["./packages/tractor-ts/test/test-utils.ts"]
      // ... outros aliases
    }
  },
  "exclude": ["node_modules", "dist", "build", "pkg", "**/*.test.ts"]
}
```

---

## 2. O Pacote `@refarm.dev/tsconfig` (Bases Reutilizáveis)

O pacote `@refarm.dev/tsconfig` (`packages/tsconfig`) é uma biblioteca interna que fornece **conjuntos de configurações TypeScript reutilizáveis**. Ele não é uma configuração global em si, mas sim um conjunto de bases que outros `tsconfig.json` podem estender.

### Propósito Principal:

*   **Consistência e Redução de Duplicação**: Evita que cada pacote precise redefinir opções de compilador que são comuns a um determinado ambiente (Node.js, Browser).
*   **Contextos Específicos**: Oferece configurações baseadas em cenários de uso:
    *   `base.json`: Configurações fundamentais que se aplicam a qualquer projeto TypeScript.
    *   `node.json`: Estende `base.json` e adiciona `lib` específicas para ambientes Node.js.
    *   `dom.json`: Estende `base.json` e adiciona `lib` específicas para ambientes de navegador (DOM).

### Exemplo de `base.json`:

```json
// packages/tsconfig/base.json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Refarm Base",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

---

## 3. A Relação: Como os Pacotes se Conectam

Os `tsconfig.json` dos pacotes individuais (`packages/barn/tsconfig.json`, `packages/tractor-ts/tsconfig.json`) são os que realmente orquestram a compilação. Eles `extend`em as configurações da raiz e/ou do `@refarm.dev/tsconfig` para construir sua configuração final.

### Padrão Comum para Pacotes:

Um `tsconfig.json` típico de um pacote TypeScript no Refarm se parece com isto:

```json
// packages/meu-pacote/tsconfig.json
{
  "extends": "../../tsconfig.json", // Estende a configuração global da raiz
  "compilerOptions": {
    "noEmit": true, // Não emite arquivos JS/D.TS neste tsconfig (apenas para verificação de tipos)
    "composite": false,
    "declaration": false,
    "declarationMap": false,
    "outDir": "./dist",
    "baseUrl": "../.." // Importante para resolver caminhos relativos dentro do monorepo
  },
  "include": ["src/**/*", "tests/**/*"], // Inclui o código-fonte e os testes
  "exclude": ["node_modules", "dist"]
}
```

E um `tsconfig.build.json` para o processo de build:

```json
// packages/meu-pacote/tsconfig.build.json
{
  "extends": "./tsconfig.json", // Estende o tsconfig.json local
  "compilerOptions": {
    "noEmit": false, // Permite a emissão de arquivos JS/D.TS
    "declaration": true, // Gera arquivos .d.ts
    "declarationMap": true,
    "emitDeclarationOnly": false // Emite JS e D.TS
  },
  "include": ["src/**/*"] // Apenas o código-fonte para o build
}
```

### Em Resumo:

*   O **`tsconfig.json` da raiz** define o **padrão global** e os **aliases de módulos** para todo o monorepo.
*   O **`@refarm.dev/tsconfig`** fornece **bases reutilizáveis** para diferentes ambientes.
*   Os **`tsconfig.json` dos pacotes** estendem essas configurações para definir seu comportamento específico de verificação de tipos e build.

Essa estratificação permite que o Refarm mantenha a consistência, aproveite a herança de configurações e otimize o processo de build e desenvolvimento para cada pacote, ao mesmo tempo em que oferece uma experiência de desenvolvimento coesa no VS Code.

---

## Referências

[1] [TypeScript Handbook - Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
[2] [TypeScript Handbook - `extends` in `tsconfig.json`](https://www.typescriptlang.org/docs/handbook/tsconfig-json.html#extends)
[3] [Refarm `docs/STRATIFICATION.md`](./STRATIFICATION.md) - Sovereign Stratification: Hybrid Management Policy (JS/TS)
