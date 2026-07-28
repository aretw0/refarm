# @refarm.dev/login-flow

Drive an interactive **connect/login CLI to a ready state**. Many logins are a command that
streams text and, somewhere in that stream, reaches a connected state, fails, asks for a secret,
or needs the human to do something out-of-band (approve a push on a phone, tap a hardware token).
This is the generic engine for that — `expect(1)` scoped to "reach a connected state".

Give it how to spawn the process and a few patterns; it watches the stream, answers prompts via
stdin (secrets write-only, never logged), surfaces human notices, and resolves when the process
reaches `ready` — or fails / times out.

## Why injectable

The process is injected (`spec.spawn`), so the whole state machine is testable with a **fake** —
no real process, network, or phone. `spawnLoginProcess` is the thin `node:child_process` adapter
for real use (stdout+stderr merged, delivered as raw chunks so a prompt without a trailing
newline — `Senha (token): ` — is still matched).

Nothing here is vendor-specific: the argv and patterns are the caller's data. A concrete client
(e.g. Serpro's `ovpnctl`) is a small adapter that fills them in.

## Usage

```ts
import { runLoginFlow, spawnLoginProcess } from "@refarm.dev/login-flow";

const outcome = await runLoginFlow({
  spawn: () => spawnLoginProcess("/opt/ovpnserpro/ovpnctl", ["connect", certId, profileId]),
  ready: /Conectado/,
  fail: /Saindo: auth-failure/,
  // A push-approval step: tell the human, don't block on a terminal prompt.
  notices: [{ match: /Conectando/, message: "Aprove a conexão no seu app SerproID (celular)…" }],
  // A fallback if a token password IS asked (read it with hidden input here).
  prompts: [{ match: /Senha \((.*)\): /, respond: (m) => readHidden(`Senha do token ${m[1]}`), label: "token-password" }],
  onEvent: (e) => console.log(e.kind, e.message ?? ""),
  timeoutMs: 120_000,
});

if (outcome.ok) {
  // SUCCESS leaves the process running — a connect CLI HOLDS the tunnel. Monitor/kill it later.
  monitorConnection(outcome.process);
}
```

## Semantics

- **`ready`** (a stream pattern) is the success signal. On success the process is **left running**
  — a connect CLI like `ovpnctl` holds the connection after it reports ready; the caller
  monitors/kills it via `outcome.process`.
- **`fail`** / **timeout** kill the process and resolve `{ ok: false }`.
- The process **exiting before `ready`** is a failure (the target is a connected state).
- **prompts** are answered via stdin and fire once per occurrence; the returned response is
  written to stdin only — never in the transcript or events. Read secrets with hidden input
  inside `respond`.
- **notices** surface a message to the human and do not settle the flow.

## Testing

The state machine is unit-tested against a fake process (`src/index.test.ts`); `spawnLoginProcess`
is covered by an end-to-end test driving a real child process to `ready`. No real service needed.
