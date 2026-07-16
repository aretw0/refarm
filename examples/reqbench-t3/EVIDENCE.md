# Caixa de Notas de Requisitos — o que este exemplo prova

Registro honesto do que a bancada de requisitos **demonstra** e do que **não** pode ser afirmado. O
fluxo é **descobrir → puxar → curar → ler**: um analista começa um vault do zero, puxa requisitos de um
sistema, promove correções e revisão, e lê um MOC navegável. Cada linha aponta o verbo, o teste e o arquivo.

## O que prova (por capacidade)

| Capacidade | O que prova (frase honesta) | Selo | Como prova |
|---|---|---|---|
| Ingestão (`requirements-pull`) | Login garantido (o fixture loga instantâneo, offline) → um seam de fetch → parse (HTML **e** OSLC/RDF) → registro persistido. Multi-fonte: dois sistemas (EFD, NFE) agregam num vault, roteados por `sistema`. | **REAL** (vault Obsidian em disco, idempotente) | `flow.e2e.test.ts` (multi-source); `persona.ts` (`requirements-pull`), `oslc.ts` (parse RDF). |
| **JSON-LD** | **Todo registro já é um documento JSON-LD** — carrega um `@context` público, `@type` e um identificador estável — nos **três** caminhos de ingestão. O `@context` é **realmente servido** como `application/ld+json` (com `@vocab` e coerção de tipo). O Markdown é a projeção humana derivada, não o contrário. | **REAL** (documento + contexto servido) | `fixture.ts:98`, `persona.ts:152`, `oslc.ts:273` estampam o `@context`; o contexto é servido em `apps/site/.../contexts/records/v1` (`Content-Type: application/ld+json`). |
| Histórico + diff (`requirements-history` / `requirements-diff`) | O histórico é **append-only** e a diferença é **revisável por campo** — uma correção **não muta** o estado, entra no histórico com **cadeia de hash-pai**. Toda automação tem modo de simulação e só escreve sob `--apply`. | **REAL** | `flow.e2e.test.ts` (HISTORY: `versions: 2`, cadeia de `parentHash`); `persona.ts` (`requirements-history`, `requirements-diff`). |
| Gate de publicação (`requirements-materialize`) | Só requisitos **revisados por um humano** são materializados em notas; um pull de rotina **não publica** um rascunho — `review.state !== "reviewed"` é retido (salvo `--include-drafts`), com `skippedDrafts` reportado. | **REAL** | `materialize.test.ts` (o gate + `--include-drafts`); `persona.ts:createRequirementsMaterializeCapability`. |
| Preservação de curação | Um re-pull de rotina **refresca o conteúdo sem reverter** a curação humana: a revisão que um humano fez e as **relações** derivadas do RDF são preservadas (o pull HTML nem sequer as parseia). | **REAL** | `curation-preserve.test.ts` (`preserveCuration`); `flow.e2e.test.ts` ("CURATION SURVIVES A RE-PULL"): pull → review → re-pull → ainda reviewed. |
| Saúde do corpus (`requirements-health`) | Órfãos, duplicados e danglings são detectados **cross-record** — o que gates por-nota não veem. | **REAL** | `flow.e2e.test.ts`; `vault-overview.ts`. |
| Busca (`requirements-search`) | Busca por texto (`--tipo`/`--sistema`) sobre o corpus. | **REAL** | `persona.ts`. |
| Lab (`requirements-lab --export`) | O grafo de requisitos publicado como dataset reativo + notebook (Marimo → WASM/Pyodide). | **REAL** (export byte-exato) | `lab/analise-grafo.py` (fonte); `persona.ts` (export via `uvx`). |
| `requirements-report [--apply]` | Um `report.md` do estado do vault (cobertura / rastreabilidade / saúde / histórico) com números reais, carimbo **SHA-256** por arquivo + manifesto `evidence.json`. | derivado (+ stamp REAL) | `report.ts` → `createEvidenceBundleCapability`. |

## Artefatos produzidos

- **`dgk requirements-materialize --apply`** → notas Obsidian em disco (frontmatter + colocação PARA,
  idempotente — um re-run de registros inalterados escreve `0`).
- **`dgk requirements-report --apply`** → `.dgk/report/T3-report.md` + `.dgk/report/evidence.json` (SHA-256).
- **`dgk requirements-lab --export`** → `.dgk/lab/` (dataset) + o export HTML+WASM do notebook (derivado —
  ver `lab/.gitignore`).
- Estado local: `.dgk/requirements.manifest.json` (registros + revisões). Figuras: `diagrams/{composition,flow}.svg`.

## Limites honestos

- **A cadeia de hash é FNV-1a 32-bit** (`fnv1a32:…`, `records-contract-v1/reference.ts`). Dizer **"cadeia de
  hash-pai"** é seguro; **JAMAIS** "sha256", "criptográfico", "tamper-evident" ou "à prova de adulteração" para
  o histórico de requisitos. _(O carimbo de execução do `report`/`evidence.json` é SHA-256 real — isso é dos
  arquivos de saída, não da cadeia de revisões.)_
- **`--live` é um teste de fumaça OSLC de artefato ÚNICO** da cadeia login → GET autenticado → parse → registro.
  **Não** descobre projeto, **não** abre dashboard, **não** pagina, **não** segue links `/rm/…`. Multi-fonte
  (EFD/NFE) é provado **só no ledger offline**.
- **Sem validação de interoperabilidade JSON-LD com consumidor externo** (`grep jsonld|expand|frame` → **zero**;
  nenhuma dep `jsonld`). O documento é JSON-LD e o contexto é servido; **não** escrever "interoperabilidade
  validada".
- **Não existe chave literal `@id`** nos registros: existe `id: "record:…"` que **resolve** para `@id` via o
  alias `id: "@id"` do contexto servido. Correto em JSON-LD, mas um leitor que abrir `fixture.ts` e não achar
  `@id` pode concluir inflação — declarar isso.
- Integração real depende de **consumidor e política editorial do domínio**; o núcleo governável é o que se prova.
