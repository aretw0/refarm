# Protocol Specs

This directory stores versioned protocol contracts. Use the narrowest format
that matches the transport:

- HTTP request/response APIs: OpenAPI under `http/`
- Event streams or pub/sub APIs: AsyncAPI, when introduced
- WASI/component boundaries: WIT, when introduced
- Shared payloads independent of transport: JSON Schema, when introduced

OpenAPI is for HTTP only; it is not the umbrella format for every protocol.

`http/farmhand-sidecar.openapi.v1.json` mirrors the sidecar routes implemented by:

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
