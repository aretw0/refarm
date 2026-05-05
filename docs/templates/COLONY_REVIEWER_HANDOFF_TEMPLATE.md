# Colony Reviewer Handoff Template

## Batch context
- Batch scope: `<domínio/lote>`
- Tasks included: `<T-...>`

## Merge readiness
- [ ] Smoke evidences anexadas por task
- [ ] Full gate executado (`npm run gate:full:colony`)
- [ ] Source Sovereignty preservada
- [ ] Rastreabilidade task → commit → verification

## Rollback plan
1. Primeiro revert em boundaries críticos (`tractor*`, `.project`, workflows)
2. Reexecutar smoke do domínio afetado
3. Reexecutar full gate

## Pending questions
- `<pergunta aberta>`

## Reviewer decision
- Decision: `<approve/request-changes/hold>`
- Notes: `<...>`
