# Colony Operational Playbook (Refarm)

Guia operacional para execução de lotes paralelos com segurança no monorepo.

## 1) Preflight

### 1.1 Preflight rápido (obrigatório)

```bash
node scripts/reso.mjs status
npm run project:validate --silent
npm run factory:preflight
```

### 1.2 Preflight completo (runtime/security boundaries)

```bash
npm run gate:smoke:runtime
```

### 1.3 Go / No-Go

- **GO**: preflight rápido verde; se houver boundary runtime/security, preflight completo verde.
- **NO-GO**: qualquer falha em toolchain, `reso status`, ou validação obrigatória.

---

## 2) Execução por domínio

### Foundation

```bash
npm run gate:smoke:foundation
```

### Contracts + Storage/Sync

```bash
npm run gate:smoke:contracts
```

### Runtime

```bash
npm run gate:smoke:runtime
```

### Consolidação de lote

```bash
npm run gate:full:colony
```

---

## 3) Política de lock e anti-colisão

Áreas serializadas:

- `packages/tractor/**`
- `packages/tractor-ts/**`
- `packages/plugin-manifest/**`
- `.project/**`
- `.github/workflows/**`

Regras:

1. Claim no handoff antes de tocar área serializada.
2. Um único worker ativo por área serializada.
3. Handoff explícito ao transferir ownership.

---

## 4) Escalonamento de bloqueio

Escalar para humano quando houver:

- falha persistente de preflight/toolchain;
- conflito entre decisões arquiteturais não resolvidas;
- colisão recorrente em áreas serializadas;
- necessidade de exceção de segurança/política.

Abrir/atualizar issue quando:

- o bloqueio for reproduzível;
- impactar mais de uma task;
- exigir ação fora do slice atual.

Cancelar task quando:

- requisito original foi invalidado por decisão posterior;
- custo/risco supera prioridade atual;
- há caminho alternativo já aceito.

---

## 5) Trilha de transição (pi agora vs Refarm agente)

### Ajustes que ficam no **pi atual** (curto prazo)

- governança de execução (preflight, smoke/full, checklist de reviewer);
- formato de evidência e handoff;
- guardrails de monitor para evitar ações não autorizadas.

### Ajustes que ficam para o **agente Refarm** (migração)

- políticas de roteamento de modelos em host-side (ADR-012 quando aceito);
- integração nativa das mesmas gates no runtime do agente Refarm;
- consolidação de automações sem depender da camada operacional do pi.

Princípio: manter compatibilidade de processo agora para migrar sem quebrar throughput depois.

## 6) Exemplos de atribuição por task

- `T-PIPE-02` → `worker-foundation` (config/toolbox/vtconfig/cli)
- `T-PIPE-04` → `worker-runtime` (tractor-rs/tractor-ts)
- `T-PIPE-05` → `worker-contracts` (contracts + storage/sync)
- `T-OPS-03` → `worker-governance` (.pi/monitors + AGENTS)

Modelo recomendado de branch:

- `task/<TASK-ID>-<slug>`
- Ex.: `task/T-PIPE-02-foundation-typecheck`

---

## 7) Evidência mínima por slice

Toda conclusão deve registrar:

- comandos executados,
- resultado observado,
- critérios de aceite com status (`passed`/`failed`/`skipped`),
- `verification id` ligado à task.

Templates recomendados:

- `docs/templates/COLONY_TASK_INPUT_TEMPLATE.md`
- `docs/templates/COLONY_WORKER_EVIDENCE_REPORT_TEMPLATE.md`
- `docs/templates/COLONY_REVIEWER_HANDOFF_TEMPLATE.md`

## 8) Checkpoint antes de compactação

Quando a sessão estiver próxima do limite de contexto:

1. consolidar tasks/verifications do lote atual;
2. atualizar `.project/handoff.json` com `next_actions` objetivos;
3. registrar um `VER-CHECKPOINT-*` em `.project/verification.json`;
4. validar consistência (`npm run project:validate --silent`);
5. parar em estado limpo (sem mudanças pendentes fora do checkpoint).

Resultado esperado: próxima sessão retoma sem depender de memória implícita.
