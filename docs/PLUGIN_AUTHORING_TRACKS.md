# Plugin Authoring Tracks (.js → .wasm)

Refarm adota estratégia **dual-track** para reduzir fricção de onboarding sem perder hardening progressivo.

## TL;DR

- Você **pode começar com plugin `.js/.mjs/.cjs`**.
- O trilho de maior segurança/isolamento é **`.wasm`**.
- A migração JS → WASM é recomendada por maturidade, não bloqueio de entrada.

---

## 1) Até onde um plugin pode ir?

Um plugin no Refarm é uma unidade de extensão com **entry executável** + **manifesto** + **capabilities**.

### Superfícies de extensão

1. **Runtime (headless)**
   - comandos, automações, integrações, processamento de dados.
2. **UI (slots/metadados)**
   - superfícies visuais, painéis, configurações, widgets.
3. **Assets associados**
   - CSS, HTML templates, ícones, JSON, dicionários i18n, etc.

> CSS/HTML sozinhos não são plugin executável.
> Eles entram como **asset pack** carregado por um entry JS/WASM.

---

## 2) Exemplo prático: plugin de temas com marketplace próprio

Sim, esse cenário é válido.

Um plugin `theme-hub` pode:
- expor API de gestão de tema,
- renderizar UI própria,
- manter catálogo remoto/local de temas,
- baixar pacotes de tema (CSS/tokens/templates),
- aplicar tema no host seguindo permissões/capabilities.

Ou seja: o plugin não precisa ser "só executor"; ele pode orquestrar um ecossistema de artefatos (incluindo um marketplace vertical).

---

## 3) Mínimo vs máximo (envelope de plugin)

## Mínimo (L0)

Plugin executável simples com:
- manifesto válido,
- `entry` suportado,
- hooks obrigatórios de observability,
- capability mínima declarada.

Objetivo: provar ciclo de vida e integração básica.

## Máximo (L3)

Plugin com:
- runtime robusto + API própria,
- UI completa + assets,
- estratégia de distribuição/versionamento,
- políticas de segurança maduras (integridade, trust, promoção por ambiente),
- readiness para migração/execução WASM quando aplicável.

---

## 4) Matriz por ambiente e formato (estado atual)

| Formato de entry | Browser | Node | Status |
|---|---|---|---|
| `.js` | ✅ suportado | ✅ suportado | **supported** |
| `.mjs` | ✅ suportado | ✅ suportado | **supported** |
| `.cjs` | ⚠️ parcial (validado no manifesto; runtime browser não é alvo primário) | ✅ suportado | **partial** |
| `.wasm` | ⚠️ parcial (cache-backed no browser; requer install prévio e runner compatível) | ✅ suportado | **partial/browser + supported/node** |

Notas:
- `.wasm` exige `integrity: sha256-*` no manifesto.
- Browser `.wasm` depende de cache instalado (`installPlugin`) + runtime compatível (ADR-044 ainda em evolução).
- No runtime browser atual, `module` executa diretamente e `component` executa quando acompanhado de `browserRuntimeModule` + `browserRuntimeDescriptor` cacheados e íntegros.
- Para reduzir ambiguidade, prefira descriptor gerado por toolchain (`runtime-module:descriptor`) em vez de sidecar manual.
- `trusted-fast` (quando usado) é restrito a entradas `.wasm` no runtime atual.
- JS path é onboarding pragmático; WASM path é hardening prioritário.

---

## 5) Trilha de escala (L0 → L3)

| Nível | Objetivo | Formato típico | Controles |
|---|---|---|---|
| L0 — Seed | Plugin mínimo funcional | `.js/.mjs` | manifesto válido, hooks obrigatórios, capabilities mínimas |
| L1 — Productive | Uso em fluxo real | `.js/.mjs/.cjs` | testes de contrato, observability consistente, limites de permissão |
| L2 — Hardened | Segurança reforçada | `.wasm` (ou JS com política restrita) | integridade forte, trust profile, checklist pré-produção |
| L3 — Sovereign | Escala/ecossistema | `.wasm` preferencial + assets/ui | governança de release, política por ambiente, métricas de operação |

### Critérios de promoção

- **L0 → L1**: cobre caso real de uso com testes de regressão.
- **L1 → L2**: adota controles explícitos de segurança (integridade/trust/políticas).
- **L2 → L3**: estabilidade operacional + governança de distribuição.

---

## 6) Política recomendada

1. **MVP**: permitir JS (`.js/.mjs/.cjs`) para reduzir tempo de entrada.
2. **Pré-produção**: exigir baseline de segurança/observability.
3. **Produção sensível**: priorizar WASM e controles de hardening completos.

---

## 7) Nota de produto

WASM não é “fingerprint mágico” obrigatório para todo plugin. Ele é um mecanismo de execução mais previsível e verificável. A estratégia soberana é **progressão de maturidade**, não exclusão de quem está começando.
