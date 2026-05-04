# ADR-060 — Tractor HTTP Sidecar Protocol

**Status:** Accepted  
**Date:** 2026-05-04  
**Author:** Arthur Silva  

## Context

`refarm ask` submits efforts to a local HTTP sidecar on `:42001`. Today that sidecar is implemented in farmhand (Node.js). Per ADR-059, tractor Rust becomes the authoritative runtime and must implement the same protocol so clients (`refarm ask`, future UIs) are runtime-agnostic.

The canonical protocol definition is extracted from `apps/farmhand/src/transports/http.ts` (`SidecarAdapter` interface + `HttpSidecar` route table).

## Protocol

**Base:** `http://127.0.0.1:42001`  
**Format:** `application/json` everywhere  
**Auth:** none (loopback only)

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/efforts` | Submit a new effort; returns `{ effortId }` |
| `GET` | `/efforts` | List all effort results |
| `GET` | `/efforts/summary` | Aggregate summary |
| `GET` | `/efforts/:id` | Get single effort result; 404 if unknown |
| `GET` | `/efforts/:id/logs` | Effort log entries; 404 if unknown |
| `POST` | `/efforts/:id/retry` | Re-enqueue failed effort; 409 if not allowed |
| `POST` | `/efforts/:id/cancel` | Cancel pending effort; 409 if not allowed |

### Effort submission

```
POST /efforts
Content-Type: application/json

{
  "id": "<uuid>",
  "direction": "ask",
  "tasks": [
    {
      "id": "<uuid>",
      "pluginId": "@refarm/pi-agent",
      "fn": "respond",
      "args": { "prompt": "...", "system": "..." }
    }
  ],
  "source": "refarm-ask",
  "submittedAt": "<iso8601>"
}

→ 200 { "effortId": "<uuid>" }
```

Submission is **fire-and-forget**: the sidecar accepts the effort and returns immediately. Execution is async; results arrive via stream files or `GET /efforts/:id`.

### Stream files

The stream side-channel is filesystem-based (ADR-058 — file transport):

```
~/.refarm/streams/<stream-ref>.ndjson
```

Each line is a `StreamChunk`:
```json
{ "stream_ref": "...", "sequence": 0, "content": "...", "is_final": false }
{ "stream_ref": "...", "sequence": 1, "content": "...", "is_final": true, "metadata": { "model": "...", "tokens_in": 0, "tokens_out": 0 } }
```

`refarm ask` polls the stream file at 100ms intervals until `is_final: true` or timeout (45s default).

### Effort result

```
GET /efforts/:id

→ 200 {
    "id": "<uuid>",
    "status": "done" | "failed" | "pending" | "active",
    "results": [
      { "status": "ok" | "error", "result": "<content or object>", "error": "..." }
    ]
  }
```

### Error shape

All errors return:
```json
{ "error": "<message>" }
```

With appropriate HTTP status (400 bad request, 404 not found, 409 conflict, 500 internal).

## Implementation Notes for tractor Rust

- Use **Axum** (already available via tokio dependency tree; add `axum = "0.7"` to Cargo.toml)
- Bind on `127.0.0.1` only — never `0.0.0.0`
- CLI flag: `--http-port <PORT>` (default `42001`); `--no-http` to disable
- Effort execution is async: spawn a tokio task per effort, write stream chunks to `~/.refarm/streams/`
- Stream file path mirrors farmhand: `<streams-dir>/<stream-ref>.ndjson`
- `streams-dir` defaults to `~/.refarm/streams/`; overridable via `--streams-dir`

## Invariants

1. `POST /efforts` must return before execution completes — clients must not block on submission.
2. Stream files must be written atomically per chunk (append + flush, not tmp-rename — readers poll line-by-line).
3. `is_final: true` chunk must be the last line written to the stream file.
4. A runtime that cannot execute a task must write `is_final: true` with an error-bearing `metadata` rather than leaving the stream file absent — clients timeout otherwise.

## Conformance

Any runtime claiming to implement this protocol must pass:
- `scripts/ci/smoke-task-pi-agent-respond.mjs` (effort submission + stream read)
- `refarm ask "ping"` end-to-end with stream completion

## Related

- ADR-059: Tractor Rust as Authoritative Runtime
- ADR-058: Context Injection Doctrine
- `apps/farmhand/src/transports/http.ts` — canonical TypeScript reference implementation
- `apps/farmhand/src/transports/file.ts` — stream file transport reference
