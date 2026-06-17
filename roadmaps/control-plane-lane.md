# Lane: Control Plane Pessoal (Universal, canal-agnóstico)

Objetivo: manter Refarm como base de controle da tua vida e trabalho, no teu computador, com a mesma semântica atravessando qualquer superfície (`file`, `http`, `channel:*`, Telegram, Matrix, etc.) sem travar no pacote de hoje.

> Sem cronograma temporal. Progresso é governado por **checkpoints de estado** (checklist), mantendo a referência viva entre sessões.

## Princípios de navegação do lane

1. **De cima para baixo** quando precisa de direção (arquitetura/contrato).
2. **De baixo para cima** quando precisa de confiança (implementação/testes).
3. **Se não tem dono claro, é infra neutra** (não acoplar à `farmhand` ou `pi-agent` quando não precisa).
4. **Contract first** em `packages/*` e não em apps específicos.
5. **Canônico = menos mutável**: contratos em `specs/features`/`specs/ADRs`.

## Fontes de direção (roadmaps dos packages envolvidos)

- `packages/dispatch-surface-rs/ROADMAP.md` (control-surface canônico)
- `packages/cli/ROADMAP.md` (CLI agnóstico com camada de compat)
- `packages/plugin-courier/ROADMAP.md` (entrada/sinalização por HTTP)
- `packages/registry/ROADMAP.md` (descoberta/ativação de plugins)
- `packages/plugin-manifest/ROADMAP.md` (capability contract entre runtime e plugin)
- `packages/tractor/docs/ROADMAP.md` (runtime canônico alvo do ciclo diário)
- `apps/refarm` e `apps/farmhand` (clientes/runtimes transitórios atuais)

## Checklist persistente da lane

### 0) Base contratual estável (sem regressões)

- [x] `@refarm.dev/dispatch-surface` e `dispatch-surface-rs` com parsing/caminhos/capacidades de canal alinhados.
- [x] Erro canônico de transporte preservado: `Invalid task transport "...". Use: file, http, channel:<name>`.
- [x] Documentação canônica consolidada fora de `docs/superpowers` (decisão registrada em `docs/decision-log.md`).
- [x] CI/roteiro de build verifica contrato novo em `specs/features/dispatch-control-plane-contract.md`.
- [ ] Contrato de canal versionado no nível de feature/ADR quando necessário (semântico + sem quebrar semântica).

### 1) Runtime de controle canônico pronto para múltiplos canais

- [ ] `channel:*` resolvido por adapter com capabilities por operação (`submit`, `query`, `logs`, `summary`, `list`, `retry`, `cancel`).
- [ ] Erros de operação sem capability retornam sinal determinístico (ex.: `405` + body estável).
- [ ] Runtime de controle principal (Tractor) já é o caminho de produção da camada daemon.
- [ ] `farmhand` atua como compat/ponte apenas onde necessário, com trilha explícita de remoção.

### 2) Interface única de canal (sem duplicação)

- [ ] CLI (`apps/refarm`) usa as mesmas abstrações de `dispatch-surface` para envio/consulta/status/retry.
- [ ] CLI e runtime compartilham normalização de payload (`source`, `context`, `submittedAt`, `replyTo`, `traceIds`).
- [ ] Contrato de logs/summary/status preserva forma estável entre `http` e canais (`channel:*`).

### 3) Primeiro gateway de canal externo real (prova prática)

- [ ] Gateway Telegram **ou** Matrix criado com o mesmo esquema de intenção/resultado.
- [ ] O gateway emite esforço em `channel:<nome>` e respeita capabilities do runtime.
- [ ] O gateway consegue `query/list/logs/retry/cancel` quando permitido.
- [ ] Teste de ponta a ponta independente do stack atual de chat/agent.

### 4) Controle pessoal (teu fluxo de vida)

- [ ] `@refarm.dev/dispatch-surface` + `@refarm.dev/task-contract-v1`/`session-contract-v1`/`stream-contract-v1` são as bases de dados entre canais e ambientes.
- [ ] Boot local confiável com runtime + canal + observabilidade mínima.
- [ ] Catálogo de integrações/canais versionado em arquivo local (ex.: `~/.refarm/channels.toml` ou equivalente no runtime).
- [ ] Documentação de operação pessoal atualizada com comandos de inicialização por contexto (desktop / trabalho / projeto).

## Estado de decisão persistente

- Não usar estimativas temporais nesta lane.
- Cada checkbox é o único estado a persistir por sessão.
- Progresso sobe com commit atômico e `docs/decision-log.md` atualizado somente em mudanças de nível técnico.
