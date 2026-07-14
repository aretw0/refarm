# T2 — Cidadão Digital / carteira soberana (wallet)

Exemplo: [`examples/wallet-t2`](../../examples/wallet-t2/README.md) · Tema (postura): "Citizen data
wallet" ([Theme 2](../POC_WRITING_HANDOFF.md)).

## O que o trabalho pede

Persona = **cidadão soberano**; **result mode** — apresentar o PRODUTO/benefício, não a máquina.
Local-first: o cidadão detém seus dados; a carteira é o portal diário (referência: `apps/me`, o
"Sovereign Citizen Hub"). O foco é o avanço que o trabalho traz, com uma face web real — não a
técnica. (Fonte: seção *Focus* do README do exemplo.)

## Como o exemplo prova (verbos + testes)

- **Credenciais W3C VC, verificação real** — `import` (local-first) · `verify` (assinatura +
  validade; `--strict` adiciona revogação + confiança no emissor) · `share` (apresentação assinada,
  só o escolhido). Um emissor fora do trust registry (`DGK_TRUSTED_ISSUERS`) é RECUSADO mesmo com
  assinatura válida.
- **O outro lado do loop** — `verify-presentation` (o serviço receptor valida holder-binding; uma
  apresentação vazia é recusada).
- **Consentimento soberano** — `authorize`/`present`/`revoke` (escopo, propósito, expiração);
  `history` mostra active → revoked como revisões; o `RevocationEvent` guarda quando/por quê.
- **Recuperação** — `recover` (a mesma sessão re-deriva a MESMA identidade num device novo, sem
  expor a chave). `DGK_SOVEREIGN=1` põe a identidade num signer Ed25519 WASM (a chave nunca sai do
  sandbox).
- **A postura numa visão** — `sovereignty` (o dashboard: credenciais + consentimentos + disclosure
  + timeline).

## Figuras

- [`diagrams/composition.svg`](../../examples/wallet-t2/diagrams/composition.svg) — arquitetura (app do cidadão + SDK genérico).
- [`diagrams/flow.svg`](../../examples/wallet-t2/diagrams/flow.svg) — a jornada (importar → verificar → compartilhar → ver).
- `dgk report --apply` → `.dgk/report/disclosure-graph.svg` (a superfície de compartilhamento).

## Números

```bash
pnpm --filter wallet-t2 dgk report --apply   # → .dgk/report/T2-report.md + disclosure-graph.svg
```

O `report.md` traz os valores reais: credenciais verificadas, consentimentos ativos/revogados, e a
última mudança soberana (do histórico). Cada afirmação tem um teste que a comprova.

## Postura de escrita

Ver [POC_WRITING_HANDOFF.md](../POC_WRITING_HANDOFF.md) e a linha "Citizen data wallet" em
[POC_PRIZE_READINESS.md](../POC_PRIZE_READINESS.md). **Não dizer:** que há conformidade LGPD/W3C
VC/OpenID4VP/EUDI certificada, ou UX de produção pronta — é uma prova local, avaliável com critérios
de piloto.
