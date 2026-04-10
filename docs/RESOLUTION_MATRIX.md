# Matriz de Resolucao do Monorepo

Este documento registra o snapshot operacional da resolucao interna do Refarm e a classificacao esperada de cada classe de pacote. Ele nao substitui a politica descrita em docs/DEVELOPMENT_RESOLUTION.md; ele a materializa.

Data de referencia deste snapshot: 2026-04-09.

Fonte operacional usada para a leitura de estado:

- node scripts/reso.mjs status
- tsconfig.json raiz
- package.json dos pacotes de referencia

---

## 1. Como ler esta matriz

### Colunas

- Estrato: classificacao principal do pacote no monorepo.
- Alias atual: forma como o tsconfig raiz aponta para o pacote ou subpath.
- Estado atual: leitura operacional do reso status no momento do snapshot.
- Superficie alvo: onde o pacote deve expor sua API quando o fluxo de publish exigir menor surpresa.
- Notes: excecoes, observacoes e criterios.

### Estratos usados aqui

- TS-Strict toggleable
- JS-Atomic local
- JS-Atomic root-resolved
- Multi-entry/subpaths
- Always published / special surface
- App / bootloader

---

## 2. Pacotes de referencia e destino esperado

| Pacote ou subpath | Estrato | Alias atual | Estado atual | Superficie alvo | Notes |
| --- | --- | --- | --- | --- | --- |
| @refarm.dev/vtconfig | JS-Atomic root-resolved | ./packages/vtconfig | LOCAL (src) | raiz do pacote com types/exports coerentes | Caso de referencia para alias por diretorio. |
| @refarm.dev/config | JS-Atomic local | ./packages/config/src/index | LOCAL (src) | dist endurecido para publish; src para DX local enquanto necessario | Ainda segue modelo direto para src/index. |
| @refarm.dev/plugin-manifest | JS-Atomic local | packages/plugin-manifest/src/index | LOCAL (src) | dist ou raiz endurecida, conforme publish strategy | Ja possui types em src/index.d.ts, mas ainda nao usa alias por diretorio. |
| @refarm.dev/toolbox | JS-Atomic local | alias generico via @refarm.dev/<pkg> -> ./packages/<pkg>/src | LOCAL (src) | definir superficie publica dedicada antes de migrar alias | CLI interno; hoje opera diretamente em src. |
| @refarm.dev/barn | TS-Strict toggleable | ./packages/barn/src/index | PUBLISHED (dist) | dist/index.* | Exemplo classico de biblioteca TS-Strict. |
| @refarm.dev/cli | TS-Strict toggleable | ./packages/cli/src/index | PUBLISHED (dist) | dist/index.* | Superficie de CLI deve continuar compilada. |
| @refarm.dev/tractor | TS-Strict toggleable com subpath | ./packages/tractor-ts/src/index | PUBLISHED (dist) | dist/src/index.* e subpath de test-utils em dist/test | Possui exports condicionais e subpath ./test/test-utils. |
| @refarm.dev/tractor/test/test-utils | Multi-entry/subpaths | ./packages/tractor-ts/test/test-utils | PUBLISHED (dist) | dist/test/test-utils.* | Subpath explicitamente modelado no tsconfig e no package.json. |
| @refarm.dev/homestead/sdk | Multi-entry/subpaths | ./packages/homestead/src/sdk/index | PUBLISHED (dist) | dist/sdk/index.* | Subpath publicado explicitamente via exports. |
| @refarm.dev/homestead/ui | Multi-entry/subpaths | ./packages/homestead/src/ui/index | PUBLISHED (dist) | dist/ui/index.* | Mesmo criterio do sdk. |
| @refarm.dev/heartwood | Always published / special surface | alias generico via @refarm.dev/<pkg> -> ./packages/<pkg>/src | PUBLISHED (dist) | pkg/ ou artefato especial controlado | Superficie WASM nao deve ser tratada como biblioteca JS comum. |
| @refarm.dev/storage-memory | Always published / special surface | alias generico via @refarm.dev/<pkg> -> ./packages/<pkg>/src | PUBLISHED (dist) | dist estabilizado | Mantido frequentemente como implementacao de referencia estavel. |
| @refarm.dev/tsconfig | Always published / special surface | nao exposto no tsconfig raiz como alias operacional comum | PUBLISHED (dist) | pacote de configuracao estavel | Nao participa do fluxo src/dist como biblioteca de runtime. |
| apps/dev | App / bootloader | n/a | LOCAL (src) | src local; publish tratado separadamente | Apps nao entram no ciclo de chaveamento do reso. |
| apps/farmhand | App / bootloader | n/a | LOCAL (src) | src local; publish tratado separadamente | Mesmo criterio de apps. |
| apps/me | App / bootloader | n/a | LOCAL (src) | src local; publish tratado separadamente | Mesmo criterio de apps. |

---

## 3. Snapshot do reso status

Saida registrada em 2026-04-09:

### Packages em LOCAL (src)

- config
- plugin-manifest
- toolbox
- vtconfig

### Packages em PUBLISHED (dist)

- barn
- cli
- ds
- fence
- health
- heartwood
- homestead
- identity-contract-v1
- identity-nostr
- plugin-courier
- plugin-tem
- registry
- scarecrow
- silo
- sower
- storage-contract-v1
- storage-memory
- storage-rest
- storage-sqlite
- sync-contract-v1
- sync-crdt
- sync-loro
- terminal-plugin
- thresher
- tractor
- tractor-ts
- tsconfig
- windmill

### Apps em LOCAL (src)

- dev
- farmhand
- me

---

## 4. Regra para aliases do tsconfig

### Usar alias para src/index quando

- o pacote ainda esta em endurecimento de sua superficie publica
- a raiz do pacote nao expoe os exports e types de forma fiel
- o objetivo principal e navegacao e DX local

### Usar alias para a raiz do pacote quando

- package.json exports representa a superficie publica real
- package.json types aponta para a declaracao correta
- a raiz do pacote tem um entrypoint de tipos suficiente para o editor
- queremos que o editor enxergue a mesma interface publica que um import da raiz enxergaria

Estado atual conhecido:

- vtconfig satisfaz esse criterio e por isso aparece como ./packages/vtconfig no tsconfig.
- config e plugin-manifest ainda nao foram migrados para esse modelo, embora possam evoluir para isso no futuro.

---

## 5. Objetivo de medio prazo

Quando a publicacao no npm se tornar parte do fluxo normal, esta matriz deve permitir responder rapidamente:

1. qual e a superficie publicada correta de cada pacote
2. quais aliases do tsconfig sao apenas atalho de desenvolvimento
3. quais pacotes precisam de endurecimento de exports/types antes de migrar para alias por diretorio
4. quais subpaths exigem validacao dedicada em dist

O objetivo nao e forcar todos os pacotes ao mesmo desenho agora. O objetivo e que as diferencas atuais estejam nomeadas, justificadas e mapeadas.

---

## 6. Atualizacao da matriz

Atualize este documento quando ocorrer pelo menos um dos eventos abaixo:

- um pacote migrar de alias src/index para alias de diretorio
- um pacote ganhar ou perder subpaths publicados
- um pacote JS-Atomic ganhar superficie publicada endurecida
- o reso mudar a classificacao operacional de um pacote
- uma nova excecao estrutural surgir para publish, dist ou pkg

Checklist minimo de verificacao ao atualizar:

1. rodar node scripts/reso.mjs status
2. revisar tsconfig.json raiz
3. revisar package.json do pacote alterado
4. alinhar docs/DEVELOPMENT_RESOLUTION.md se a regra geral mudar
