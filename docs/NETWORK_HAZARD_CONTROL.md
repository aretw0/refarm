# Network Hazard Control

This note captures the operational policy for network calls in Refarm to avoid
long-hanging requests, resource starvation, and accidental “zombie” runtime behavior.

## Policy

- Every production `fetch(...)` should use an explicit timeout (or go through a timeout wrapper).
- Timeout should prefer `AbortSignal.timeout(...)` when available.
- CI bootstrap/smoke scripts that poll local endpoints should also set short
  per-poll timeouts and keep an outer deadline loop.
- Internal control-plane calls should use `fetchSidecarWithTimeout(...)` in app
  command paths.

## Default timeouts in current code

- CLI OAuth and token exchange: fixed 15s–30s.
- Session/sidecar calls:
  - Default sidecar request timeout: 500ms by default via `sidecar-fetch.ts`
  - Environment override: `REFARM_SIDE_REQUEST_TIMEOUT_MS`
- Runtime/plugin fetch gates:
  - `@refarm.dev/tractor-ts` plugin loaders and WASI passthrough:
    15s–30s in current handlers.
- CI scripts:
  - GitHub API calls in CI helpers/scripts use 10s–15s guards.
  - Local sidecar readiness polls use short 2s per-poll windows with outer 20s+ budgets.

## Operational commands (for on-demand verification)

Use a local scanner when touching networked paths:

```bash
rg -n --glob '!**/*.md' --glob '!**/*.test.ts' \
  --glob '!**/*.test.tsx' --glob '!**/*.spec.ts' --glob '!**/*.spec.tsx' \
  --glob '!**/test/**' --glob '!**/tests/**' --glob '!**/fixtures/**' \
  --glob '!**/*.d.ts' \
  "fetch\\(" apps packages scripts
```

This helps spot `fetch` callsites before refactors.

Session/CI loop hygiene:

```bash
pnpm run session:heavy:ci-watch         # non-blocking CI loop observability
pnpm run session:heavy:ci-watch:guard    # blocks if CI-loop pressure is above guardrails
pnpm run session:heavy:ci-watch:legacy   # same guardrail, explicitly on legacy .pi sessions
pnpm run session:heavy:repeat            # repeat-command pressure for current sessions
```

For focused root-cause checks after long sessions:

```bash
node scripts/session-heavy.mjs --json --session-sources
node scripts/session-heavy.mjs --json --session-source pi --allow-legacy-pi-roots --filter "gh run view"
node scripts/session-heavy.mjs --json --session-source refarm --filter "gh run view"
node scripts/session-heavy.mjs --json --session-source refarm --filter "gh run view" | jq '.sessionSource,.top[0],.ciWatchLoops.top[0]'
```

Output de JSON desse scanner agora inclui `sessionSource` e `sessionFile`:
- `sessionSource`: origem da busca (refarm/pi), caminho/etag do diretório e modo de resolução.
- `sessionFile`: arquivo onde o comando foi encontrado em cada item de `top` e de `ciWatchLoops.top`.

### Ponta da sessão suspeita (modo diagnóstico)

Use este fluxo para encontrar rapidamente a sessão que gerou o gargalo:

```bash
node scripts/session-heavy.mjs --json --session-source auto --filter "gh run view" --recent 6 --count 20 --ci-loop-signal
```

Critério:

- `sessionSource.legacySource === true` indica origem `.pi` (legacy); priorize correção fora do fluxo diário do refarm.
- `ciWatchLoops.count > 0` e `ciWatchLoops.top[0].sessionFile` apontam o arquivo exato de origem.
- Em caso de bloqueio, rode o mesmo comando com `--session-source refarm` para isolar o que é operacional de projeto.

Recommended hard rule:

- avoid manual polling patterns like `for ...; do gh run view ...; sleep ...; done`
- prefer `gh run watch <run-id> --exit-status` or `gh run watch <run-id>`

## Commit lineage

- `a00e1f7f` — timeout guard in WASI HTTP outgoing handler
- `340379e8` — remote loader timeout hardening
- `195999b8` — runtime descriptor revocation fetch timeout
- `3df9553f` — CI scripts timeout hardening

## Why this exists

This is intentionally a narrow production resilience layer: it reduces blast radius
from slow network hangs while preserving behavior and compatibility of existing
calling contracts.
