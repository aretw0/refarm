# Plugin Authoring Tracks (.js → .wasm)

Refarm adota uma estratégia **dual-track** para evitar fricção de onboarding sem abrir mão de hardening progressivo.

## TL;DR

- Você **pode começar com plugin `.js`**.
- O trilho de maior segurança/isolamento é **`.wasm`**.
- A migração `.js` → `.wasm` é recomendada, mas não bloqueante no início.

## Matriz de capacidades por trilha

| Tema | Track JS | Track WASM |
|---|---|---|
| Onboarding | Mais rápido (sem toolchain WASM) | Requer toolchain e curva inicial |
| Integridade de artefato | Opcional por política local | `sha256-*` obrigatório no manifesto para `.wasm` |
| Isolamento/sandbox | Dependente do runtime JS | Boundary mais forte via WASM + contrato host |
| Portabilidade de runtime | Boa em ambientes JS | Forte entre hosts compatíveis com WASM |
| Hardening atual no Refarm | Suporte pragmático | Caminho principal de hardening |

## Política recomendada

1. **MVP**: permitir `.js` para reduzir tempo de entrada.
2. **Pré-produção**: exigir checklist de segurança mínima (`permissions`, hooks, observability).
3. **Produção sensível**: priorizar `.wasm` com integridade e controles de trust profile.

## Roadmap sugerido para times

1. Publicar plugin funcional em `.js`.
2. Estabilizar API/capabilities e testes de contrato.
3. Migrar bundle crítico para `.wasm`.
4. Ativar políticas mais restritivas para deploy crítico.

## Nota de produto

WASM não é “fingerprint mágico” obrigatório para todo plugin. Ele é principalmente um **mecanismo de execução mais confiável e verificável**. A estratégia soberana é permitir progressão de maturidade sem excluir equipes iniciantes.
