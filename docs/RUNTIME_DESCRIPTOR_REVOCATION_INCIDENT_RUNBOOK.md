# Runtime Descriptor Revocation Incident Runbook

Playbook operacional para incidentes no canal `external-signed` (descriptor comprometido, hash incorreto, provenance inválida ou endpoint de revogação indisponível).

## 1) Critérios de acionamento

Acione este runbook quando houver qualquer um dos sinais:

- load/install bloqueado por descriptor revogado;
- suspeita de comprometimento de descriptor sidecar;
- divergência entre `descriptorIntegrity` e artefato publicado;
- indisponibilidade prolongada de `runtime-descriptor-revocations.json`.

## 2) Classificação rápida

- **SEV-1**: produção sensível afetada ou risco de supply-chain ativo.
- **SEV-2**: staging/prod não sensível afetado sem evidência de comprometimento ativo.
- **SEV-3**: apenas dev/local com impacto operacional limitado.

## 3) Linha do tempo alvo (<24h)

1. **T+0h → T+2h**
   - confirmar hash(s) afetados e releases impactados;
   - nomear owner do incidente;
   - congelar novos publishes até triagem mínima.
2. **T+2h → T+8h**
   - gerar atualização de revogação;
   - publicar assets de release atualizados (manifest/revocations);
   - preparar descriptor substituto quando aplicável.
3. **T+8h → T+24h**
   - comunicar impacto/ação corretiva;
   - validar reinstalação e recuperação;
   - registrar postmortem inicial.

## 4) Execução técnica (canônica)

### 4.1 Regerar bundle e revocation payload

```bash
npm run runtime-descriptor:bundle
```

Edite `.artifacts/runtime-descriptors/bundle.revocations.json` adicionando os `descriptorHash` revogados.

### 4.2 Verificar caminho de release (dry-run)

```bash
npm run runtime-descriptor:release-smoke -- --sha "incident-<id>"
```

### 4.3 Publicar assets no release

No workflow de release (`release-changesets`), garantir upload dos aliases estáveis:

- `runtime-descriptor-manifest.json`
- `runtime-descriptor-revocations.json`

## 5) Verificação pós-correção

Executar:

```bash
npm --prefix packages/tractor-ts run type-check
npm --prefix packages/tractor-ts run test:unit -- install-plugin browser-plugin-host runtime-descriptor-revocation-policy runtime-descriptor-revocation
npm run gate:smoke:runtime
```

Confirmar sinais esperados em runtime/install:

- `system:descriptor_revocation_config_invalid`
- `system:descriptor_revocation_config_conflict`
- `system:descriptor_revocation_stale_cache_used`
- `system:descriptor_revocation_unavailable`

## 6) Comunicação mínima

- janela de impacto;
- plugins/versões afetados;
- hash(s) revogados;
- ação requerida do consumidor (ex.: reinstalar plugin);
- status de mitigação.

## 7) Fechamento

- atualizar `.project/verification.json` com evidências;
- atualizar `.project/handoff.json` com pendências residuais;
- anexar lições aprendidas em ADR/doc relevante.
