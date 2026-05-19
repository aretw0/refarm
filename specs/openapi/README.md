# OpenAPI Specs

This directory stores versioned HTTP protocol contracts.

`farmhand-sidecar.v1.json` mirrors the sidecar routes implemented by:

- `apps/farmhand/src/transports/http.ts`
- `apps/farmhand/src/transports/sessions.ts`
- `apps/farmhand/src/transports/plugins.ts`

Only implemented routes belong in this contract. CLI-only expectations that do
not have a farmhand handler yet should first become implementation work or an
explicit protocol decision.

Validate specs with:

```bash
pnpm run openapi:check
```
