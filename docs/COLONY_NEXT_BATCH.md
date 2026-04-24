# Colony Next Batch (post-push)

Objetivo: preparar um novo lote curto (~10 slices) e encerrar em checkpoint pronto para compactação.

## Slices do lote

1. `SLICE-01` — ritual pós-push/observação CI documentado.
2. `SLICE-02` — política offline de revogação documentada por ambiente.
3. `SLICE-03` — protocolo de checkpoint pré-compactação documentado.
4. `SLICE-04` — requirements de transição pi→Refarm adicionados.
5. `SLICE-05` — requirements de política offline/revogação adicionados.
6. `SLICE-06` — tasks de transição/migração adicionadas ao board.
7. `SLICE-07` — decisões de transição adicionais registradas.
8. `SLICE-08` — snapshot de progresso atualizado.
9. `SLICE-09` — verification do lote registrada.
10. `SLICE-10` — handoff de checkpoint pronto para compactação.

## Critério de saída

- `.project` validado (`npm run project:validate --silent`);
- `git status` limpo após commit;
- handoff com `next_actions` e `key_decisions_pending` explícitos.
