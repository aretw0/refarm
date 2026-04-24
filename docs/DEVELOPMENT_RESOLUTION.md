# Resolucao de Modulos no Refarm: src, dist e raiz do pacote

Este documento define como o monorepo Refarm resolve modulos internos durante desenvolvimento, validacao e futura publicacao. O objetivo e reduzir ambiguidade sobre quando um pacote deve apontar para src, quando deve apontar para dist e quando um alias pode apontar para a raiz do pacote.

Ele deve ser lido em conjunto com:

- docs/STRATIFICATION.md para entender a diferenca entre TS-Strict e JS-Atomic.
- docs/TYPESCRIPT_INFRASTRUCTURE.md para entender o papel do tsconfig.json raiz e dos paths.
- docs/DISTRIBUTION_STRATEGY.md para entender a superficie alvo de distribuicao.
- docs/RESOLUTION_MATRIX.md para ver o snapshot operacional atual.

---

## 1. As tres camadas de resolucao

No Refarm, a resolucao de modulos internos nao depende de um unico mecanismo. Hoje existem tres camadas complementares:

1. tsconfig.json raiz
   - Controla a experiencia de desenvolvimento no editor e a resolucao TypeScript em tempo de compilacao.
   - Define aliases como @refarm.dev/tractor, @refarm.dev/homestead/sdk e @refarm.dev/vtconfig.

2. @refarm.dev/vtconfig
   - Controla a resolucao usada pelos testes Vitest e por alguns apps Vite.
   - Seu helper getAliases() pode alternar entre src e dist com VITEST_USE_DIST e VITEST_FORCE_DIST.

3. reso
   - Altera persistentemente main, types e exports nos package.json dos pacotes do monorepo.
   - E o mecanismo operacional para trocar o workspace entre uma leitura local, centrada em src, e uma leitura mais fiel ao estado publicado, centrada em dist.

Essas camadas nao competem; elas atuam em momentos diferentes.

| Camada | Escopo | Momento | Fonte de verdade |
| --- | --- | --- | --- |
| tsconfig paths | Editor e compilacao TypeScript | Desenvolvimento diario | tsconfig.json |
| vtconfig/getAliases | Testes Vitest e alguns fluxos Vite | Validacao local e de CI | packages/vtconfig |
| reso | package.json de packages | Troca global de modo src/dist | packages/toolbox/src/reso.mjs |

---

## 2. O mecanismo reso

O comando reso vive em packages/toolbox/src/reso.mjs e possui um wrapper de compatibilidade em scripts/reso.mjs.

### Comandos disponiveis

| Comando | Acao | Uso recomendado |
| --- | --- | --- |
| node scripts/reso.mjs src | Move pacotes compativeis para superficies locais em src/test quando possivel. | Desenvolvimento ativo no monorepo. |
| node scripts/reso.mjs dist | Move pacotes compativeis para superficies em dist/pkg. | Validacao pre-publicacao, integracao e CI. |
| node scripts/reso.mjs status | Mostra o estado operacional atual dos pacotes e apps. | Diagnostico de ambiente. |
| node scripts/reso.mjs sync-tsconfig | Regenera os paths do tsconfig.json raiz a partir da estrutura dos pacotes. | Quando a topologia de aliases do monorepo muda. |

### O que o reso altera

O reso opera sobre:

- main
- types
- exports

Ele nao substitui o tsconfig.json raiz automaticamente quando voce troca para src ou dist. O ajuste dos paths do tsconfig e uma acao separada, feita por sync-tsconfig.

### Como o status é calculado

O modo status considera um pacote como LOCAL (src) quando sua superfície principal aponta para src, test, .ts ou .mts, desde que não aponte para dist ou pkg. Caso contrário, ele o considera PUBLISHED (dist).

Para apps, o status é LOCAL (src) se a app possui pasta src, porque apps não são consumidos como bibliotecas internas do mesmo modo que packages.

---

## 3. Taxonomia de resolução do monorepo

Para reduzir carga cognitiva, os pacotes devem ser lidos por classe, nao caso a caso.

### 3.1 TS-Strict com chaveamento src/dist

Pacotes TS-Strict normalmente possuem tsconfig.build.json e uma superficie publicada em dist. Sao o caso mais proximo do fluxo esperado para npm.

Exemplos:

- @refarm.dev/barn
- @refarm.dev/tractor
- @refarm.dev/storage-sqlite
- @refarm.dev/sync-contract-v1

Regra operacional:

- Em desenvolvimento, podem ser inspecionados por aliases locais do tsconfig.
- Para validacao de distribuicao, o objetivo e que a superficie publicada esteja em dist.

### 3.2 JS-Atomic com source em src

Pacotes JS-Atomic usam .js ou .mjs em src como fonte de verdade. Neles, src nao e artefato intermediario; e o proprio produto-fonte.

Exemplos atuais:

- @refarm.dev/config
- @refarm.dev/plugin-manifest
- @refarm.dev/toolbox
- @refarm.dev/vtconfig

Regra operacional:

- Eles podem permanecer LOCAL (src) sem que isso seja, por si so, um erro.
- O criterio correto nao e perguntar se estao em src, mas se a superficie publica ja esta endurecida o bastante para consumo externo e para publish.

### 3.3 Pacotes root-resolved

Um pacote e root-resolved quando o alias do tsconfig aponta para a raiz do diretorio do pacote, e nao diretamente para src/index.

Exemplo atual:

- @refarm.dev/vtconfig -> ./packages/vtconfig

Isso so e desejavel quando a raiz do pacote ja expoe uma superficie coerente de importacao e tipagem, tipicamente com:

- package.json com types consistente
- package.json com exports coerente
- um index.d.ts na raiz, se necessario, reexportando a superficie publica

Sem isso, o editor pode enxergar um subconjunto errado dos exports nomeados, como ocorreu com vtconfig antes do ajuste recente.

### 3.4 Pacotes com subpaths

Alguns pacotes expoem subpaths que nao se encaixam no alias padrao para src/index.

Exemplos:

- @refarm.dev/homestead/sdk
- @refarm.dev/homestead/ui
- @refarm.dev/tractor/test/test-utils

Nesses casos, a politica de resolucao precisa considerar cada subpath explicitamente. Isso vale tanto para tsconfig paths quanto para exports publicados.

### 3.5 Pacotes sempre published ou com superficie especial

Alguns pacotes ficam intencionalmente ancorados em dist ou pkg porque sua superficie de consumo nao deve oscilar livremente.

Exemplos documentados:

- @refarm.dev/tsconfig
- @refarm.dev/heartwood
- @refarm.dev/storage-memory
- partes de @refarm.dev/homestead

O motivo varia: configuracao pura, artefatos WASM, contrato estavel ou superficie multientry em dist.

### 3.6 Apps

Apps em apps/ nao sao tratados como bibliotecas internas pelo reso. Elas permanecem em fluxo local, normalmente com src como superficie de desenvolvimento.

Exemplos:

- apps/dev
- apps/farmhand
- apps/me

---

## 4. Como escolher o tipo de alias no tsconfig

### 4.1 Regra padrao: alias direto para src/index

Esta e a escolha mais segura quando:

- o pacote ainda esta em endurecimento de superficie publica
- a raiz do pacote nao representa fielmente sua API de tipos
- o objetivo principal e DX local e navegacao direta ao codigo-fonte

Exemplos atuais:

- @refarm.dev/config -> ./packages/config/src/index
- @refarm.dev/barn -> ./packages/barn/src/index

### 4.2 Regra excepcional e reproduzivel: alias para a raiz do pacote

Use alias para a raiz do pacote somente quando a raiz do pacote ja representa corretamente a interface publica esperada pelo editor.

Checklist minimo:

1. package.json com exports coerente para o entrypoint raiz.
2. package.json com types apontando para a declaracao correta.
3. Se necessario, index.d.ts na raiz para reexportar a superficie publica.
4. O editor precisa enxergar os mesmos exports que o runtime enxergaria ao importar o pacote.

O caso de referencia hoje e:

- @refarm.dev/vtconfig -> ./packages/vtconfig

Isso nao significa que todo pacote deve migrar automaticamente para esse modelo. Significa apenas que, quando um pacote precisar ser consumido pela raiz com fidelidade de exports e types, esse e o padrao a seguir.

---

## 5. Papel do vtconfig

O vtconfig e importante porque ele prova que resolucao e tipagem publica nao sao preocupacoes separadas.

Hoje ele cumpre tres papeis:

1. Compartilha configuracao Vitest para o monorepo.
2. Compartilha helpers de Vite para apps com WASM e headers de isolamento.
3. Funciona como exemplo de pacote root-resolved, com types e exports alinhados pela raiz.

### Variaveis de ambiente relevantes

| Variavel | Efeito |
| --- | --- |
| VITEST_USE_DIST=true | Faz getAliases() preferir dist para os pacotes que suportam esse fluxo. |
| VITEST_FORCE_DIST=pkg1,pkg2 | Forca pacotes especificos para dist, mesmo sem trocar o workspace inteiro. |

Essas variaveis sao uteis quando voce quer validar uma combinacao mais proxima de publish sem alterar permanentemente todos os package.json via reso.

---

## 6. Snapshot operacional atual

O snapshot detalhado fica em docs/RESOLUTION_MATRIX.md.

Resumo operacional observado em 2026-04-09 via node scripts/reso.mjs status:

- LOCAL (src): config, plugin-manifest, toolbox, vtconfig e apps.
- PUBLISHED (dist): a maior parte dos pacotes TS-Strict, incluindo barn, cli, ds, fence, tractor, storage-sqlite, sync-* e afins.
- PUBLISHED (dist) com particularidades: heartwood, homestead, storage-memory, tsconfig.

Leitura correta desse snapshot:

- Ele nao significa que todo pacote em LOCAL esta pronto para publish a partir de src.
- Ele nao significa que todo pacote em PUBLISHED ja esta completamente endurecido para npm.
- Ele registra apenas a superficie operacional atual do workspace.

---

## 7. Relacao com a futura publicacao no npm

Hoje o monorepo ainda nao depende de publish real no npm para operar internamente, mas a documentacao deve preparar esse salto para ser barato cognitivamente.

A regra de destino continua sendo:

- bibliotecas publicadas devem ter superficie estavel em dist ou artefato equivalente controlado
- exports e types devem refletir essa superficie
- o tsconfig do monorepo pode continuar usando aliases locais para DX, desde que isso esteja documentado e nao esconda divergencias reais

O papel da matriz de resolucao e justamente mostrar, pacote por pacote, onde estamos hoje e qual deve ser a superficie alvo quando o publish passar a ser parte do fluxo normal.

---

## 8. Troubleshooting

### 8.1 O editor enxerga menos exports do que o runtime

Causa comum:

- alias do tsconfig apontando para um diretorio de pacote cuja raiz ainda nao expoe corretamente types/exports

Mitigacao:

- voltar temporariamente para src/index no alias, ou
- alinhar a raiz do pacote com package.json types/exports e um index.d.ts de reexportacao

### 8.2 O pacote funciona no build, mas nao nos testes

Causa comum:

- tsconfig paths e vtconfig/getAliases estao apontando para superficies diferentes

Mitigacao:

- validar o estado atual com node scripts/reso.mjs status
- revisar VITEST_USE_DIST e VITEST_FORCE_DIST
- confirmar se o pacote esta sendo lido por src, dist ou raiz do pacote em cada camada

### 8.3 O alias do tsconfig nao acompanha a reorganizacao dos pacotes

Mitigacao:

- rodar node scripts/reso.mjs sync-tsconfig
- revisar manualmente os casos especiais, como homestead, tractor test-utils e root-resolved packages

### 8.4 O Vite/Astro falha em subpaths internos

Mitigacao:

- criar aliases explicitos para subpaths como /sdk e /ui
- garantir que os exports publicados do pacote espelham o mesmo desenho

---

## 9. Regras praticas

1. Nao chute para onde um pacote esta apontando; rode node scripts/reso.mjs status.
2. Use alias para src/index como padrao local.
3. Use alias para a raiz do pacote apenas quando a raiz ja for uma superficie publica coerente.
4. Trate vtconfig como um exemplo de criterio reproduzivel, nao como excecao arbitraria.
5. Quando um pacote ganhar subpaths ou endurecimento para publish, atualize a matriz de resolucao junto com o codigo.

---

## 10. Checklist operacional (operadores)

Use esta sequência para evitar drift entre desenvolvimento e validação:

```bash
# 1) Início da task
node scripts/reso.mjs status
node scripts/reso.mjs src

# 2) Antes de abrir PR
node scripts/reso.mjs dist
npm run gate:smoke:foundation

# 3) Pré-merge em branch protegida
node scripts/reso.mjs status
npm run gate:full:colony
```

### Critérios de alternância

- Mude para **src** quando estiver implementando/refatorando localmente.
- Mude para **dist** quando precisar validar superfície de publicação/integração.
- Sempre rode **status** antes de concluir ou transferir uma task.

## Referencias

- docs/STRATIFICATION.md
- docs/TYPESCRIPT_INFRASTRUCTURE.md
- docs/DISTRIBUTION_STRATEGY.md
- docs/RESOLUTION_MATRIX.md
- packages/toolbox/src/reso.mjs
- packages/vtconfig/src/index.js
