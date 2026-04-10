# Infraestrutura TypeScript no Refarm

Este documento esclarece a arquitetura da configuracao TypeScript no monorepo Refarm, detalhando a funcao do tsconfig.json da raiz, do pacote @refarm.dev/tsconfig e da politica de aliases usada para resolver os pacotes internos.

---

## 1. O tsconfig.json da raiz

O arquivo tsconfig.json na raiz do monorepo define a configuracao TypeScript global e unificada para o workspace.

Ele cumpre tres papeis:

1. define opcoes comuns de compilacao
2. define exclusoes globais
3. define o mapa de aliases do monorepo em compilerOptions.paths

Esse terceiro papel e o mais importante para a resolucao de modulos internos.

---

## 2. O pacote @refarm.dev/tsconfig

O pacote packages/tsconfig fornece bases reutilizaveis para diferentes ambientes.

Arquivos principais:

- base.json
- node.json
- dom.json

Eles servem como camadas de configuracao reutilizaveis. O tsconfig raiz e os tsconfig dos pacotes continuam sendo os pontos que de fato orquestram a resolucao local do monorepo.

---

## 3. O papel real dos paths

No Refarm, os paths do tsconfig nao sao apenas atalhos ergonomicos. Eles materializam uma politica de resolucao local.

Esses aliases respondem perguntas como:

- o editor deve abrir a fonte local ou a superficie publica do pacote?
- este pacote deve ser consumido por src/index ou pela raiz do pacote?
- este pacote tem subpaths explicitos, como /sdk, /ui ou /test/test-utils?

Por isso, mudar um path nao e apenas reorganizar DX; e ajustar o contrato operacional do monorepo.

---

## 4. Dois formatos de alias

### 4.1 Alias direto para src/index

Este e o formato predominante no monorepo.

Exemplos:

```json
"@refarm.dev/config": ["./packages/config/src/index"],
"@refarm.dev/barn": ["./packages/barn/src/index"],
"@refarm.dev/cli": ["./packages/cli/src/index"]
```

Quando usar:

- o pacote ainda esta em desenvolvimento ativo de sua superficie publica
- queremos navegacao direta para a fonte local
- a raiz do pacote ainda nao representa fielmente os exports e types publicos

### 4.2 Alias para a raiz do pacote

Este formato deve ser usado somente quando a raiz do pacote ja representa corretamente sua superficie publica.

Exemplo atual:

```json
"@refarm.dev/vtconfig": ["./packages/vtconfig"]
```

Quando isso faz sentido:

- package.json exports esta coerente
- package.json types esta coerente
- existe entrada de tipos suficiente na raiz do pacote, se necessario
- o editor deve enxergar a mesma interface publica que um import da raiz enxerga

No vtconfig, isso exigiu uma entrada de tipos na raiz do pacote, para que exports nomeados como withWasmBrowserConfig fossem reconhecidos corretamente pelo editor.

---

## 5. Subpaths e aliases especiais

Nem todo pacote cabe no padrao src/index.

Exemplos atuais:

```json
"@refarm.dev/homestead/sdk": ["./packages/homestead/src/sdk/index"],
"@refarm.dev/homestead/ui": ["./packages/homestead/src/ui/index"],
"@refarm.dev/tractor/test/test-utils": ["./packages/tractor-ts/test/test-utils"]
```

Esses casos existem porque certos pacotes expoem multiplos entrypoints locais e publicados. Quando um pacote ganha esse desenho, os paths do tsconfig precisam ser tratados como parte do contrato do pacote, nao como detalhe incidental.

---

## 6. Relacao com vtconfig e reso

O tsconfig raiz nao atua sozinho.

### vtconfig

O pacote @refarm.dev/vtconfig adiciona uma camada de resolucao para Vitest e alguns fluxos Vite. Seu helper getAliases() consegue alternar entre src e dist usando:

- VITEST_USE_DIST=true
- VITEST_FORCE_DIST=pkg1,pkg2

### reso

O comando reso altera package.json dos pacotes e oferece um ponto de observacao global com:

- node scripts/reso.mjs src
- node scripts/reso.mjs dist
- node scripts/reso.mjs status
- node scripts/reso.mjs sync-tsconfig

Em resumo:

- tsconfig controla a resolucao local do editor e do TypeScript
- vtconfig controla a resolucao de testes e alguns apps Vite
- reso controla a superficie declarada nos package.json

---

## 7. Padrao para tsconfig dos pacotes

Um tsconfig de pacote costuma estender o tsconfig raiz para verificacao de tipos, enquanto um tsconfig.build.json assume a emissao.

Exemplo conceitual:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "outDir": "./dist",
    "baseUrl": "../.."
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

E para build:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"]
}
```

---

## 8. Regras praticas

1. Trate compilerOptions.paths como politica de resolucao, nao so como conforto de import.
2. Use alias para src/index como padrao.
3. Promova um pacote para alias por diretorio apenas quando sua raiz estiver endurecida para types e exports.
4. Trate subpaths como contratos explicitos do pacote.
5. Quando a estrutura de aliases mudar, atualize tambem docs/DEVELOPMENT_RESOLUTION.md e docs/RESOLUTION_MATRIX.md.

---

## Referencias

- docs/DEVELOPMENT_RESOLUTION.md
- docs/DISTRIBUTION_STRATEGY.md
- docs/STRATIFICATION.md
- tsconfig.json
- packages/vtconfig/package.json
