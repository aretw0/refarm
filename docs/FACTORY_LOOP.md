# Factory Loop (Swarm-first, Queen-last)

Objetivo: adiantar trabalho verificável com pouca iteração humana, deixando para a "rainha" apenas exceções (falhas, conflitos, decisões difíceis).

## Princípios

1. **Batch pequeno e verificável**: 1–3 objetivos independentes por ciclo.
2. **Swarm em isolamento**: usar worktree isolada (default do `ant_colony`).
3. **Gates curtos**: validação mínima e objetiva por pacote.
4. **Queen por exceção**: humano só entra para conflito, arquitetura ou bug não determinístico.
5. **Checkpoint obrigatório**: atualizar `HANDOFF.md` ao fim de cada ciclo.

## Fallback operacional (sem colônias)

Quando a retenção/promoção do swarm estiver instável, operar em modo serial no branch atual:

1. **Uma mudança por vez** (escopo curto, diff pequeno).
2. **Validação imediata** no pacote alvo (sem build global).
3. **Evidência persistida** por ciclo:
   - `git diff` + `git status --short`
   - patch salvo em `/tmp/refarm-safety/`
   - checkpoint no `HANDOFF.md`.
4. **Sem merge às cegas**: só avançar para próximo item após gate passar.

Esse modo reduz throughput, mas maximiza auditabilidade e elimina risco de “trabalho órfão” de worktree efêmera.

## Loop operacional (1 ciclo)

### 0) Preflight (2 min)
- `git status -sb`
- `colony_pilot_status`
- `colony_pilot_preflight`
- Verificar storage livre (`df -h`) e evitar build global.

### 1) Seleção do lote (3 min)
Escolher tarefas com:
- fronteira clara de arquivo/pacote,
- validação local possível,
- baixo acoplamento entre si.

### 2) Execução por swarms (10–60 min)
Para cada tarefa:
- disparar `ant_colony` com objetivo fechado,
- limitar custo por ciclo (`maxCost`),
- exigir evidência: arquivos alterados + comandos de validação.

### 3) Gate de verificação (5–15 min)
Rodar apenas checks focados no pacote afetado (ex.: `cargo check --lib`, teste filtrado).

### 4) Queen triage (5–20 min)
Só tratar:
- testes quebrados,
- conflitos,
- lacunas arquiteturais,
- decisões pendentes.

### 5) Consolidação (3 min)
- atualizar `HANDOFF.md` com: pronto / pendente / próximo ciclo,
- registrar ferramentas faltantes,
- preparar commit atômico.

---

## Guardrails de custo/contexto

- Meta experimental: até **~10% da janela** por ciclo (não por tarefa).
- Limite por swarm: iniciar com `maxCost` conservador e subir por evidência.
- Proibir varreduras pesadas recorrentes (`du/find` amplos) sem necessidade.
- Se storage pressionar: limpar apenas artefatos (`target/`, `.turbo`, outputs de teste).

## Prompt base para swarm

Use este template no `ant_colony.goal`:

1. Implementar [objetivo único e verificável].
2. Restringir alterações aos arquivos necessários.
3. Rodar validação mínima no pacote afetado.
4. Reportar:
   - arquivos alterados,
   - comandos executados,
   - evidências de sucesso/falha,
   - riscos e follow-ups.
5. Não executar build global do monorepo.

## Piloto sugerido (Refarm atual)

Tarefa: `tractor-native prompt/watch` (CLI daily-driver) com validação focada em `packages/tractor`.

