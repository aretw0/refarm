# Refarm: Distribution and Build Strategy

Este documento descreve a superficie alvo de distribuicao dos pacotes do Refarm e como isso convive com a resolucao local usada durante o desenvolvimento do monorepo.

---

## 1. A regra de dist

A regra de destino continua simples:

- bibliotecas e contratos que serao consumidos fora do workspace devem expor uma superficie estavel em dist ou artefato equivalente controlado
- types e exports devem acompanhar essa mesma superficie

Racional:

1. consumo externo nao deve depender de TypeScript do monorepo
2. o que e validado em dist deve ser o mais proximo possivel do que sera publicado
3. runtimes e bundlers tendem a se comportar de forma mais previsivel em cima de JS compilado e declaracoes emitidas

---

## 2. A excecao de desenvolvimento

Durante o desenvolvimento no monorepo, usamos superficies locais para evitar ciclos desnecessarios de build-rebuild-wait.

Essas excecoes aparecem em tres lugares:

1. tsconfig.json raiz, via aliases locais
2. @refarm.dev/vtconfig, via getAliases()
3. reso, quando o workspace e trocado para src

Isso nao invalida a regra de dist. Apenas reconhece que o monorepo precisa de um modo de trabalho de baixa friccao.

---

## 3. O que deve ficar em dist e o que pode ficar em src

### Deve mirar dist

- bibliotecas TS-Strict
- contratos e SDKs que serao publicados
- CLIs executaveis
- subpaths publicados, como /sdk e /ui, quando fizerem parte da API externa

### Pode permanecer em src por mais tempo

- pacotes JS-Atomic ainda em endurecimento de superficie publica
- tooling interno do monorepo
- pacotes cuja raiz publica ainda nao foi estabilizada

Importante: permanecer em src hoje nao equivale a publicar a partir de src no futuro. Significa apenas que o pacote ainda esta operando numa superficie local legitima.

---

## 4. Custo cognitivo e publish futuro

Como o workspace ainda nao depende de pacotes realmente publicados no npm, existe o risco de o time confundir estado local com estado publicavel.

Para evitar isso, o projeto passa a assumir explicitamente dois registros complementares:

1. docs/DEVELOPMENT_RESOLUTION.md
   - regra canonica de como e por que a resolucao funciona

2. docs/RESOLUTION_MATRIX.md
   - snapshot do estado atual e superficie alvo de cada classe de pacote

Essa separacao existe para que a transicao futura para publish nao exija redescobrir o significado de cada alias, export ou excecao.

---

## 5. Superficies especiais

Alguns pacotes nao cabem no desenho simples dist/index.js.

Exemplos:

- heartwood usa artefato especial associado a WASM
- homestead expoe subpaths como /sdk e /ui
- vtconfig e um pacote de tooling que hoje funciona como caso root-resolved para tipagem publica local

Essas variacoes sao aceitaveis, desde que estejam mapeadas e documentadas. O problema nao e haver formas diferentes de superficie; o problema e elas serem implicitas.

---

## 6. Ferramentas que sustentam a estrategia

### reso

Use:

- node scripts/reso.mjs status
- node scripts/reso.mjs src
- node scripts/reso.mjs dist
- node scripts/reso.mjs sync-tsconfig

### vtconfig

Use:

- VITEST_USE_DIST=true para validar testes contra dist
- VITEST_FORCE_DIST para forcar pacotes especificos

### build/watch

Em fluxos de desenvolvimento continuo, o uso de dev/watch continua sendo o meio preferivel para manter dist sincronizado sem perder velocidade.

---

## 7. Regras praticas

1. A superficie alvo de publish deve ser explicita.
2. A superficie local de desenvolvimento tambem deve ser explicita.
3. Se um pacote divergir da regra padrao, a divergencia deve aparecer na matriz de resolucao.
4. Antes de endurecer um pacote para publish, alinhe main, types, exports e o alias do tsconfig que melhor representa sua realidade.

---

## Related ADRs

- specs/ADRs/ADR-001-monorepo-structure.md
- specs/ADRs/ADR-019-npm-scope-and-namespace-strategy.md
- docs/DEVELOPMENT_RESOLUTION.md
- docs/RESOLUTION_MATRIX.md
