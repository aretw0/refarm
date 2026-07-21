# Carteira do Cidadão — o que este exemplo prova

Registro honesto do que a carteira soberana **demonstra** e do que **não** pode ser afirmado. O eixo
central é a **soberania da chave**: no modo soberano, a identidade do cidadão é um componente WASM cuja
chave privada Ed25519 **nasce e morre dentro do sandbox** e nunca cruza a fronteira. Cada linha aponta o
verbo, o teste e o arquivo.

> **Dois modos.** Por padrão (offline, determinístico para testes) a carteira usa um _fixture_ em
> memória. Com `DGK_SOVEREIGN=1`, a identidade vira o **signer WASM soberano** — e é aí que as
> assinaturas passam a ser criptograficamente reais.

> **Nota (pós-extração).** O núcleo reutilizável (`persona`, `authorization`, `credentials`, `verifier`,
> `sovereignty`, `sovereign` + suas suítes como `sovereign.test.ts`) mora no bloco **`@refarm.dev/wallet`**;
> o `createDeterministicSigner`/`in-memory.ts` mora em `@refarm.dev/authorization-contract-v1`. Os nomes de
> arquivo/teste abaixo referem-se a esses módulos. As afirmações de capacidade permanecem verdadeiras.

## O que prova (por capacidade)

| Capacidade | O que prova (frase honesta) | Selo | Como prova |
|---|---|---|---|
| **Identidade soberana** (`DGK_SOVEREIGN=1`) | A identidade do cidadão executa como **componente WebAssembly** sob tabela de capacidades _deny-all_; a chave privada **nasce e permanece no sandbox** e é **re-derivada** após perda de dispositivo sem jamais atravessar a fronteira. O processo da carteira **não guarda chave privada**. | **REAL** | `sovereign.test.ts` — `identity.sign(id, data)` nunca recebe chave; `publicKey` é o único material exportado; assinar duas vezes é estável (re-unlock no sandbox). `sovereign.ts` (o provider de identidade WASM soberana). |
| **Jornada de consentimento soberana** (`authorize → present → verify`) | Sob modo soberano, o recibo de autorização é **assinado pela chave WASM soberana** (`ed25519-wasm-sovereign`), não pelo digest de fixture. Um recibo **adulterado falha** na verificação. | **REAL** (sob `DGK_SOVEREIGN=1`) | `sovereign.test.ts` ("the consent journey is signed by the sovereign WASM key…"); `createSovereignAuthorizationSigner` liga o `AuthorizationSigner` à identidade WASM. |
| `wallet share` / `present` (soberano) | A apresentação que a carteira constrói é **assinada dentro do sandbox** (`ed25519-wasm-sovereign` no `proof.signature`). | **REAL** (sob `DGK_SOVEREIGN=1`) | `sovereign.test.ts` ("the wallet's own `share` verb signs the presentation inside the sandbox"). |
| Cadeia de consentimento (padrão) | A trilha mínima **autorizar → apresentar → verificar → revogar** funciona em cenário determinístico offline. | **SINTÉTICO** (fixture `fixture-fnv1a`) | `authorization.test.ts` (6/6, sem passo de import); `in-memory.ts` (`createDeterministicSigner`). |
| Apresentação seletiva | O cidadão autoriza um **escopo** para um **propósito** e divulga **só esse escopo** — nunca mais que o autorizado. | **REAL** (lógica de escopo) | `authorization.ts` — escopo `faixa_etaria` divulga **só** `faixa_etaria`; os 4 atributos disponíveis em `authorization.ts` (`nome_social`, `faixa_etaria`, `municipio`, `vinculo`, **fictícios**). |
| **Prioridade local (offline-first)** | A jornada inteira — consultar o acervo, receber pedido, autorizar, apresentar e revogar — executa **com o acesso à rede removido do ambiente**, de modo que qualquer tentativa de alcançá-la falharia de forma visível. Uma carteira que precisa de conexão para mostrar ao titular o que ele já detém não é local-first, independentemente de como seja descrita. | **REAL** (comportamento, não adjetivo) | `flow.e2e.test.ts` ("the whole journey completes with the network gone"): `fetch` substituído por uma exceção nomeada. |
| **Recusa explicável** | Uma recusa **diz qual verificação a produziu**. Recibo com escopo ampliado após a emissão (`nome,documento` → inclui `dados_bancarios`, prova original mantida) é recusado citando `signature` e **não** `not-revoked`, porque a autorização segue ativa; após revogar, cita `not-revoked`. Um não opaco é indistinguível de um arbitrário para quem o recebe. | **REAL** | `flow.e2e.test.ts` (dois casos, asserções sobre QUAL verificação falhou). |
| Revogação auditável | O cidadão revoga; `present` pós-revogação **recusa**; a revogação vira uma **revisão durável** (ativa → revogada, mesma id). | **REAL** (lógica) | `authorization.ts` (`revoke`), `history` — authorize→revoke = 2 revisões. |
| `verify` (credencial) | Uma credencial expirada / revogada / de emissor não confiável é **RECUSADA** — não só a assinatura: validade + revogação (via status list no `--strict`) + confiança no emissor. | **REAL** (motor de política) | `credentials`/`trust`; `verify --strict`. **Ver limite abaixo sobre assinatura de terceiro.** |
| `report [--apply]` | O grafo de divulgação como `.svg` + um `report.md` da postura soberana, com carimbo **SHA-256** por arquivo + manifesto `evidence.json`. | derivado (+ stamp REAL) | `report.ts` → `createEvidenceBundleCapability`. |

## Artefatos produzidos

- **`dgk report --apply`** → `.dgk/report/disclosure-graph.svg` + `.dgk/report/T2-report.md` +
  `.dgk/report/evidence.json` (manifesto SHA-256).
- Estado local: `wallet.manifest.json` (registros + histórico de revisões).
- Figuras estáticas: `diagrams/composition.svg`, `diagrams/flow.svg`.

## Limites honestos (obrigatórios no texto)

- **Sem conformidade plena** com EUDI, W3C VC, OpenID4VP/OpenID4VCI nem prontidão jurídica final. A trilha
  de decisão e auditoria é o que se prova; interoperabilidade e regulação exigem etapa dedicada.
- **Dados fictícios** (`Cidadão Exemplo`, `Cidade Fictícia`, `servidor-fictício`) — nenhum dado real/sensível.
- **Persistência é JSON em TEXTO PURO, não criptografado em repouso** (`grep encrypt src/` → **zero**). O modo
  soberano protege a **chave** (garantia real e forte), **não** é criptografia dos dados em disco. Não escrever
  "dados armazenados de forma criptografada"; escrever "chave protegida no sandbox; dados locais em texto".
- **Não há resolvedor DID/verificationMethod** (`grep` → **zero**). A verificação cobre **recibos que o
  próprio holder assina** (a jornada de consentimento) — que o provider resolve porque conhece a identidade.
  **Não** reivindicar "o cidadão importa credencial de um órgão e a carteira verifica a assinatura de
  terceiro": a checagem de assinatura de terceiro não está implementada (só o motor de política decide).
- **Seleção é por-credencial, não por-campo** (sem SD-JWT/BBS+). "Controle granular" sem essa ressalva é
  overclaim para quem conhece SSI.
- As duas jornadas (importar/verificar credencial × apresentar atributos) são **disjuntas** no exemplo:
  `present` divulga do conjunto de `authorization.ts`, não das credenciais importadas.
