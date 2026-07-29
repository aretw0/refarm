# Declared connections — shared, host-owned interactive sessions

Date: 2026-07-28
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — machine empowerment / operate-model

> Revision note: an earlier pass of this design (commit `eafa847b`, filename
> `…-host-shell-flow-interactive-effect-design.md`) exposed a WIT effect where the plugin supplied
> `argv` and the host held one private session per plugin. The operator corrected the ownership
> model — connections are **shared**, not private — and that correction cascaded into a smaller,
> safer contract. See D1, D2 and D5.

## Why this, and why now

The lane's next corner was slice 3: expose `refarm workspace run` over HTTP on the tailnet so a
phone can operate a declared workspace command. Interviewing the operator moved the work **down a
layer**, for a reason worth recording.

The first operated command is `serpro-vpn connect` — an adapter over `@refarm.dev/login-flow` that
drives the real `ovpnctl`. It is live-proven from the CLI. But the operator's direction is larger
than one command: the SerproID login gates **many** SERPRO platforms, not just the ALM, and the
ladder is QR → user+password+MFA (obfuscated) → configuration wizards. Some SERPRO work needs the
VPN, some needs only a platform login, some needs neither; the rest is covered by scraping, web
automation, and other integrations. Interactive connection is therefore a **substrate** concern —
the operational layer's floor, not a VPN feature.

Asked whether Tractor was deficient, the honest answer is no, and the plugin intuition was right.
Tractor already grants plugins a shell effect (`host-shell.spawn`,
`packages/plugin-wit/wit/host.wit:95`; host impl at
`packages/tractor/src/host/host_effects_bridge/core.rs:129`), gated on `Permission::ShellSpawn`, a
trusted-plugin check, an argv allowlist, and structured argv (never shell interpolation). What is
missing is the **shape** of that effect:

```wit
spawn-request { argv, env, cwd, timeout-ms, stdin: option<list<u8>> }
spawn-result  { stdout: list<u8>, stderr: list<u8>, exit-code, timed-out }
```

All stdin goes **up front**; all stdout comes back **at the end**; `timeout-ms` **kills** the
process. It is batch, mute, and ephemeral.

An interactive login is the exact inverse, and `@refarm.dev/login-flow` documents all three reasons
in its own source:

- output must be read as **raw chunks**, because a prompt like `Senha (token): ` has no trailing
  newline (`packages/login-flow/src/index.ts:22-23`);
- stdin is written **in response to what was read**, not before;
- on success the process is **left running**, because a connect CLI like `ovpnctl` holds the tunnel
  only while it lives (`packages/login-flow/src/index.ts:92-96`).

So the VPN cannot be a sandboxed plugin today — not from a design deficiency, but because the effect
contract is mute and ephemeral while the operation is conversational and long-lived. This is the
same host-effect gap the lane recorded from the scraping side.

## The governing insight: a connection is shared, not owned

The operator's correction is the spine of this design. In real use, more than one notebook or VPN
profile is very unlikely; what **is** likely is several plugins needing the *same* connection. A
private-session model would make each of them trigger a separate login — and for the Serpro VPN a
login is a **push notification on the operator's phone**. Private sessions would turn ordinary
plugin composition into repeated human interruption.

So a connection is a **named, host-owned, shared resource with declared interest**. Plugins do not
hold processes; they hold *claims* on a name.

This generalizes past the VPN, which is the point: a logged-in SerproID application session (cookies
in a browser context) has the same shape — one live session, many consumers, one login. The VPN is
simply the first instance the operator can prove end to end.

## Decisions

### D1 — Connections are declared by the operator, not requested by the plugin

A `connections` block in `.refarm/config.json` is the catalog. A plugin can only **name** an entry;
it never supplies `argv`, patterns, or timeouts.

This is the third application of a doctrine the repo already holds — *an operation catalog, never a
shell*. It governs `workspace run`'s `commands` allowlist today, and it governs remote exposure (the
recorded slice 3 decision). Here it also **shrinks the effect's authority**: the plugin's power drops
from "keep an arbitrary process alive" to "ask for a connection the operator declared".

The Rust host already reads this file with hardening in place — size cap, regular-file requirement,
and a two-source read (filesystem plus the `SovereignConfig` graph node) at
`packages/tractor/src/host/host_effects_bridge/policy_and_fs.rs:88-150`. `trusted_plugins` already
comes from there, so `connections` joins existing machinery rather than adding a new config path.

Connections are declared at the **top level**, not per workspace: a VPN belongs to the machine, and
several workspaces legitimately share one. The workspace still owns the specific adapter binary
(`serpro-vpn` lives in rcdc5); the declaration is operator data naming it.

```jsonc
// .refarm/config.json
"connections": {
  "serpro-vpn": {
    "establish": ["serpro-vpn", "connect"],     // argv, never a shell string
    // Readiness is a PROBE, not a pattern — see D1b.
    "probe": { "run": ["ip", "-br", "link", "show", "ovpntun0"], "expect": "UP" },
    "probeIntervalMs": 1000,
    "readyTimeoutMs": 120000,
    // Accelerators and human notices only — never load-bearing for correctness.
    "notices": [
      { "pattern": "Conectando", "message": "aprove o push no celular" }
    ],
    "linger": "operator"                        // see D6
  }
}
```

### D1b — Readiness is a probe, not a pattern

**The single most important correction in this design.** An earlier pass had the host decide a
connection was up by matching a string in the process's output. For the adapter that meant matching
`✅ VPN Serpro CONECTADA` — a `console.log` line with an emoji
(`rcdc5/packages/serpro-vpn/src/cli.ts:24-43`). That is screen-scraping a UI, not consuming an
interface: any cosmetic edit breaks the connection, and correctness rests on a display string.

Refarm already assimilated the right idea for exactly this problem, one substrate over. In
`packages/browser-driver/src/session.ts:104`:

```ts
awaitLoginDetected(probe: LoginProbe, signals: LoginSignals, options)
```

Login is not detected by watching text go by — the loop **asks the system** (`currentUrl`,
`hasSelector`, `hasCookie`) until the declared signals hold. Its own doc names the case: *"a project
brings its own signals for its own SSO/app (a SerproID redirect back to the ALM, a Keycloak cookie);
the shared block just polls them."*

And rcdc5's adapter **already knows this and does both**: it matches `/Conectado/` to finish the
connect flow (`ovpnctl.ts:134`), but its supervisor's health check is
*"Is the ALM tunnel up? (`ovpntun0` in state UP)"* (`ovpnctl.ts:146-153`). The truth was always the
link state; the string was only a flow signal. The earlier pass elected the weak signal as the source
of truth and ignored the strong one.

So:

- **`probe` decides.** A structured command plus an expected output; success is exit code 0 **and**
  `expect` matching. Polled every `probeIntervalMs` until `readyTimeoutMs`.
- **`notices` accelerate and inform.** They surface human messages ("aprove o push no celular") and
  may prompt an immediate re-probe, but a missed notice is cosmetic — it can never make a connection
  wrongly considered up or down.
- **No `ready` / `fail` patterns at all.** They were load-bearing only because the probe was missing.

**The probe is structured argv, never a shell — by default.** `["sh", "-c", "… | grep -q UP"]` would
reintroduce the shell through the back door: allowing `sh` in the allowlist allows everything. Hence
`{ run: [...], expect: "..." }`, which passes the same `enforce_shell_allowlist` as any other spawn
and covers both real cases: a missing interface exits non-zero, and an existing-but-down interface
exits zero while printing `DOWN`. Shell-like binaries (`sh`, `bash`, `env`, …) are rejected by
basename, so `/bin/sh` is caught as well as `sh`.

### D1c — A probe that genuinely needs composition must ask, not be silently allowed or flatly denied

A flat "no" would eventually be wrong: some platform's health check will not fit in a single argv
(a pipe, a chained condition). A silent "yes" is worse. The rule the operator set is neither — **the
declaration announces the need, and the operator grants it.**

Refarm already owns the mechanism: `tractor-bridge` exposes
`request-permission: func(capability: string, reason: string) -> bool`
(`packages/plugin-wit/wit/host.wit:18`), and `Permission` already carries the persona-facing `label`
and `risk` for exactly this approval surface (`packages/tractor/src/host/permission.rs:112-131`).

So a composing probe declares its intent and its reason:

```jsonc
"probe": {
  "shell": "ip -br link show ovpntun0 | grep -q UP",
  "reason": "the tunnel check needs a pipe; no single argv reports link state"
}
```

Loading such a declaration does not run it. The host asks the operator, who may grant it **once**
for this attempt, or **persist** the grant for that named connection. An ungranted composing probe
is a clear error naming the connection and the reason it asked — never a silent downgrade to
"not up", which would look like a broken tunnel instead of a withheld permission.

The default stays structured-argv, so the common case needs no approval at all and the exception is
visible precisely because it is rare. **Not in step 1** — step 1 rejects `shell` outright with a
message pointing at this decision, so nothing is silently permitted before the approval path exists.

This generalizes, which is the point. A SerproID application session's probe is an HTTP request that
returns 200; a browser session's probe is `browser-driver`'s `LoginProbe`. One idea, three
substrates — cohesion rather than three ad-hoc automations.

**Consequences for this step:** nothing changes in rcdc5. The adapter stays the `establish` command
and its output stops being load-bearing, so it is now freely replaceable. The adapter also already
supervises itself (`supervise: true`, reconnect-on-drop, announcing the new push), so host-side
supervision (step 3) is redundant for this connection and cannot fight it. The convergent follow-on
is the full `ovpnctl` map — `resolve` (profile + certificate discovery, Serpro-specific, staying in
rcdc5 behind a `serpro-vpn resolve --json`) → `establish` the resolved argv → the same `probe`.
Because the probe already owns correctness, that swap becomes plumbing rather than a redesign.

## The umbrella: how connections meet plugins, automations, apps, and the operator

A connection is a **noun** — a named, shared resource with a lifecycle. `automation:v1`
(`packages/automation-contract-v1/src/types.ts`) is a **verb** — *when* work happens
(`ManualTrigger` / `CronTrigger` / `OneShotTrigger` / `EventTrigger`) and *what* work (an `Effort`).
They are different axes, and they meet at two seams that already exist rather than at a new
mechanism:

1. **One way to declare a precondition.** A plugin says `capabilities.requiresConnections` (D10). An
   automation that needs the VPN must not re-implement "connect first" — it declares the same
   requirement, in the same vocabulary. So do an app over the capability host and the operator on the
   CLI. Four consumers, one contract.
2. **Connections are observable, so automations compose with them for free.** A connection's
   lifecycle publishes `StreamSession` / `StreamChunk` nodes, and `EventTrigger` fires on an
   `eventType` such as `node.created`. "When `serpro-vpn` comes up, run the scrape" is therefore
   expressible today with no new contract: the connection emits facts, the automation reacts to
   facts.

### D2 — The host drives the loop; nobody passes a script across the boundary

The host owns the state machine. The earlier pass had the plugin declare the script in the call;
with D1 the script comes from config instead, so `run-flow` disappears from the WIT entirely. What
remains is `ensure` / `release` / `status`.

Rationale, unchanged from the earlier pass and strengthened:

- It mirrors the boundary the repo already chose for long-running streamed work:
  `model-bridge::complete-http-stream` (`packages/plugin-wit/wit/host.wit:63`) is one blocking guest
  call while the host streams and returns a cursor-bearing result.
- It preserves the doctrine at `packages/plugin-wit/wit/host.wit:40` — *"credentials stay in the
  host process (plugin never reads provider API keys)"*. A plugin-driven loop would carry every
  secret **through** the plugin on its way to stdin.
- The repo's WIT uses flat functions and ids; there are **no** component-model `resource` types in it
  today. A session-pipe design would introduce that idiom.

Accepted loss: conversation logic not expressible as pattern rules. The batch `spawn` still exists
for one-shot needs, and rules extend additively.

### D3 — `askHuman` is in the contract from day one, implemented in step 2

The prompt `answer` form has two variants, `secretRef` and `askHuman`. WIT and config schemas are the
expensive things to change; implementations are not. Declaring both now guarantees the MFA rung does
not force a contract change later.

### D4 — Regex matching, not substring

Substring matching would have avoided a new dependency (`regex` is **not** currently a Tractor
dependency) and removed ReDoS risk by construction. The operator chose regex, with a strong
supporting argument: `login-flow` matches with JS `RegExp`, so a substring-matching Rust twin would
make **shared conformance vectors meaningless** (D11).

The Rust `regex` crate is linear-time with no backtracking, so a declared pattern cannot ReDoS the
host. It does **not** support lookahead/lookbehind or backreferences — shared vectors must stay
inside the subset both engines accept. Pattern count and length are capped; a pattern that fails to
compile is a clean configuration error, never a panic.

After D1b, patterns govern only `notices` and the probe's `expect` — never whether a connection is
up. That narrows the blast radius of a bad pattern to a missed human message.

### D5 — One live instance per declared name, shared by claims

`ensure(name)` is **idempotent**: if the connection is already up it returns immediately with a new
claim and performs **no second login** — no second phone push. If it is down, the host runs the
declared flow once, even if several plugins ask concurrently (the second caller waits on the first
attempt rather than starting a rival process).

A claim is a handle a plugin releases when it no longer needs the connection. Unloading or revoking a
plugin releases its claims automatically — a plugin cannot leak interest, and cannot keep a
connection alive after it is gone.

Two live instances of the same name never exist. Wanting a second VPN profile means **declaring a
second connection**, and the error message when a conflicting request arrives says exactly that. This
is deliberate: the operator asked for the sensible default rather than a configurable free-for-all,
and for misconfiguration to be met with reality instead of silent accommodation.

### D6 — Releasing the last claim does not drop the connection by default

`linger: "operator"` (the default) keeps a connection up once established until the operator drops it
or the host shuts down. `linger: { idleMs }` is available for connections that should fall away.

The reasoning is asymmetric cost: keeping a VPN up is nearly free, while re-establishing it costs a
**human interruption** — a push the operator must approve on their phone. Dropping on last release
would produce exactly the thrash the sharing model exists to prevent.

### D7 — The result carries a cursor, never a transcript

`connection-state` returns status and a `stream_ref`, never output. A long-lived process has no "end"
at which to accumulate, and a returned transcript is one more place sensitive text can escape. Output
travels only over `stream:v1`. This matches `stream-response-result`
(`packages/plugin-wit/wit/host.wit:49`).

### D8 — Output rides the existing `stream:v1` contract; no new schema

`packages/stream-contract-v1/src/types.ts` already defines exactly the frame this needs:

```ts
interface StreamChunk {
  stream_ref: string; sequence: number; is_final: boolean;
  payload_kind?: "text_delta" | "final_text" | "final_tool_call" | "final_empty" | "error";
  metadata?: unknown;
}
```

On the Rust side, `StreamChunkObservationDraft` (`packages/tractor/src/streaming/observations.rs`)
types `payload_kind` as `String` and `metadata` as `serde_json::Value`. The new `"notice"` and
`"prompt"` kinds are therefore **data, not schema** — no Rust type changes. Only the optional TS union
gains the two variants, additively.

`StreamSessionObservationDraft` carries `stream_kind` (`"connection"`), status, and `last_sequence`.
`node_reap.rs:119-120` already refuses to sweep a non-terminal `StreamSession`, so a live tunnel's
session is not garbage-collected — behavior inherited, not invented.

### D9 — Prompt answers arrive through the host control plane, not through WIT

While a prompt is pending, a plugin that called `ensure` is **blocked**, so it cannot answer. The
answer enters through the host's own surface (a sidecar call), keyed by `prompt_id`. This is not a
workaround: it is the seam that later lets a phone answer an MFA prompt without the plugin knowing a
phone exists — and it is the same seam the CLI uses locally.

Abandonment is mandatory: `promptTimeoutMs` expiring kills the process and settles the attempt as
`failed` with a timeout reason. Never wait forever.

### D10 — Plugins declare the connections they expect

`capabilities.requiresConnections?: string[]` in the plugin manifest, mirroring the existing
`capabilities.requiresApi?: string[]` (`packages/plugin-manifest/src/index.d.ts:187`, validated for
duplicates at `packages/plugin-manifest/src/validate.js:342`).

This is what makes expectations legible before anything runs: installing a plugin that requires
`serpro-vpn` when no such connection is declared is an **install-time** error with a clear message,
not a runtime surprise.

### D11 — Two twins, kept honest by shared vectors

`login-flow` (TS, for host-side callers such as today's `serpro-vpn`) and the Rust connection engine
are two implementations of one state machine. Accepted because they serve different callers;
mitigated by a shared JSON vector file — (output chunks + rules) → (expected event sequence) —
executed by both suites.

### D12 — The operator is shown reality

Status is not optional decoration. `refarm connection status --json` (and the same payload inside
`refarm status`) reports, for every declared connection: whether it is declared, whether its binary
resolves, whether it is up, since when, how many claims and from which plugins, and the last failure
with its reason. A declared connection whose binary is missing is a **doctor finding**, not a silent
absence.

The operator asked not to be shielded from what they misconfigured or over-permitted. Concretely that
means: conflicting requests are refused loudly with the remedy in the message; a failed login
surfaces its `fail` match rather than a generic error; and claims are attributable to plugins by name.

### D13 — An attempt that needs a human must first acquire the human

**Found in real use, 2026-07-28.** The operator's VPN dropped and the supervisor reconnected while
they were away from their phone. rcdc5's adapter sets `maxAttempts: 3` (`ovpnctl.ts:221`) and
`login-flow`'s `timeoutMs` defaults to 120s, so the sequence was: push 1 → 120s → 3s backoff → push
2 → 120s → push 3 → 120s → `gaveup`. **Three phone approvals spent in about six minutes at an absent
human**, ending with the tunnel down and nothing saying so.

The defect is not the retry count. It is that the system spends a **scarce resource that only exists
when a human is present** — an approval on the operator's phone — without first establishing that
they are there. A push approval is not a retryable network operation; retrying it blind burns the
operator's attention, risks SerproID rate-limiting, and ends in a silence the operator reads as
success.

Note the asymmetry the probe (D1b) makes explicit: **probing is cheap and truthful; establishing is
expensive and human-dependent.** Today's supervisor treats them as if they cost the same.

So:

- **A declaration states whether establishing needs human attention** (the phone push, a QR scan, an
  MFA code). When it does, the host does not spawn on its own initiative: it **requests attention
  first and waits for acknowledgement**, then establishes. One push, fired when the operator said go.
- **The acknowledgement is the same seam as a prompt answer** (D9): a frame goes out on `stream:v1`,
  the reply comes back through the host's control plane. This is deliberately not a second
  mechanism — it is the one that already exists, and it is what later lets the phone itself both
  carry the request and answer it.
- **A drop does not retry into an absent human.** The connection enters an explicit `needs-attention`
  state and stays there, visible in `refarm connection status` and announced once. That is not a
  failure state; it is "waiting for you", and it is honest in a way `gaveup` is not.
- **A reconnect that needs no human is not gated.** If a flow can re-establish without human action,
  supervision proceeds normally — the gate applies only where the human is actually on the critical
  path.

This reshapes step 3: supervision is not "reconnect on drop". It is **detect the drop truthfully
(the probe), re-establish silently when no human is needed, and otherwise hold the operator's
attention request until they answer.**

**Open for the operator:** whether an unacknowledged attention request should expire (and the
connection settle as failed) or park indefinitely. The default proposed here is to park — an expiry
recreates the original defect on a longer timer, and a parked connection is discoverable in status
while an expired one is another silence.

## The contract

New interface in `packages/plugin-wit/wit/host.wit`, added to the `effect-capable` and `host-plugin`
worlds in `packages/plugin-wit/wit/worlds.wit`.

```wit
/// Shared, host-owned connections. A connection is a long-lived interactive
/// process (a VPN client holding a tunnel, a logged-in session) declared by the
/// OPERATOR in `.refarm/config.json` and named here. The plugin never supplies
/// argv, patterns, or timeouts — it asks for a declared connection by name and
/// holds a claim on it. Several plugins share ONE live connection: asking for a
/// connection that is already up performs no second login.
///
/// Gated on `connection:use`. Lower authority than `shell:spawn` — the plugin
/// does not choose what runs — but not free: establishing a connection can
/// interrupt the operator (a phone approval).
interface host-connection {
    enum connection-status { down, connecting, up, failed }

    record connection-state {
        name: string,
        status: connection-status,
        /// stream:v1 ref carrying this connection's frames (notice / prompt / terminal).
        stream-ref: string,
        /// The caller's claim, present when status is `up`. Release it when done.
        claim: option<u64>,
        /// When the current live instance came up.
        since-ns: option<u64>,
        /// Cursor of the last published frame (the resume point).
        last-sequence: u32,
    }

    /// Idempotent. Already up ⇒ returns immediately with a new claim and NO new
    /// login. Down ⇒ runs the declared flow once; concurrent callers wait on that
    /// single attempt rather than starting a rival process.
    ensure: func(name: string) -> result<connection-state, string>;

    /// Drop this caller's interest. Whether the connection itself falls is the
    /// declaration's `linger` policy, not the caller's choice.
    release: func(claim: u64) -> result<_, string>;

    /// Observe without acquiring interest.
    status: func(name: string) -> result<connection-state, string>;
}
```

Prompts live in the **config schema**, not the WIT, because they are declared by the operator:

```jsonc
"prompts": [
  { "pattern": "Senha \\((.*)\\): ", "label": "token-password",
    "answer": { "secretRef": "serpro/token-password" } },
  { "pattern": "Código MFA: ", "label": "mfa",
    "answer": { "askHuman": "código MFA" } }
]
```

## Host implementation

New file `packages/tractor/src/host/host_effects_bridge/connection.rs`, included from
`host_effects_bridge.rs` beside `core.rs` / `policy_and_fs.rs` / `capability_tools.rs` — the split the
module already practices.

It reuses the existing guards **without exception** for the process it spawns: `enforce_permission`,
`enforce_shell_allowlist`, `enforce_spawn_env`, `enforce_spawn_cwd`. A declared connection is not an
exemption from the argv allowlist — the operator declaring it does not override the machine's own
policy.

- **Registry keyed by connection name**, holding the live process, status, `stream_ref`, claim set,
  and the last failure. One entry per name, by construction.
- **Single-flight establishment**: concurrent `ensure` calls for a down connection join one attempt.
- **Accumulating buffer with a hard cap.** Matching cannot be line-based (a prompt may have no
  trailing newline), so patterns match over accumulated text, capped in bytes. Each rule fires once
  per occurrence.
- **Answers are write-only.** A prompt answer is never logged, never published as a frame, never
  retained in the published buffer — the guarantee `login-flow` states at
  `packages/login-flow/src/index.ts:89`, and the reason `secretRef` is a reference and not a value.
- **Injectable process spawn**, mirroring `login-flow`'s `spec.spawn`, so the state machine is
  unit-tested against a fake — no real process, no network, no external binary.
- **Claims released on plugin unload**, so interest cannot leak.

Permission plumbing: `Permission::ConnectionUse` in `packages/tractor/src/host/permission.rs`
(`RiskLevel::Medium`), mirrored in TS at `packages/plugin-manifest/src/permission-vocab.js` and the
union in `packages/plugin-manifest/src/index.d.ts`, plus `requiresConnections` validation.
**`packages/plugin-manifest/**` is a protected surface under CLAUDE.md §8** — those edits require
explicit operator confirmation, not routine application.

## Testing and validation economy

Host-effect tests construct `TractorNativeBindings` directly and call the `Host` trait impls (the
pattern in `packages/tractor/src/host/host_effects_bridge_tests/fs_shell_core.rs`). **No WASM
component is involved**, so this slice validates cheaply:

```bash
cargo check --quiet -p tractor
cargo test --lib connection --quiet
```

`cargo component build` is **not** part of this slice; it is needed only when a real plugin consumer
exists, which is a separate step (CLAUDE.md §7 — pay for signal, not repetition).

Coverage to write:

1. `ensure` on a down connection → flow runs, `ready` matched, status `up`, claim returned.
2. `ensure` on an up connection → returns immediately, **no second spawn**, second claim issued.
3. concurrent `ensure` on a down connection → exactly one process spawned; both callers get claims.
4. `release` of one claim while another is held → connection stays up.
5. `release` of the last claim under `linger: "operator"` → connection stays up.
6. `release` of the last claim under `linger: { idleMs }` → falls after the idle window.
7. plugin unload → its claims released; a connection with no other claimant follows its linger policy.
8. probe never succeeds → `readyTimeoutMs` settles as `failed`, process killed.
9. probe exits 0 but its output fails `expect` (interface present but `DOWN`) → not up.
10. notice rule → a `notice` frame with the human message; fires once per occurrence, and a missed
    notice changes no outcome (correctness rests on the probe alone).
11. `ensure` of an undeclared name → clean error naming the missing declaration.
12. a declaration carrying `prompts` in step 1 → **rejected at load with a clear error** (no answer
    path exists yet; accepting it would let a login hang on an unanswered prompt).
13. guards: missing `connection:use`, argv outside the shell allowlist, cwd outside root, bad env.
14. invalid regex in a declaration → clean configuration error; oversized pattern set → rejected;
    buffer cap respected.
15. sequence numbers strictly increasing across all frames of one `stream_ref`.
16. shared conformance vectors pass identically in Rust and in `login-flow`'s TS suite.

## Scope

The contract is complete in **step 1**; two of its behaviors are not.

**In (step 1):** the `connections` config block and its validation; `connection.rs`; the
`connection:use` permission and its TS mirror; `requiresConnections` in the manifest; `notice` and
terminal frames over `stream:v1`; shared claims with linger; `refarm connection status` and the doctor
finding; the tests above; docs.

This covers the Serpro VPN end to end, because it authenticates with a certificate plus a phone push
and prompts for nothing.

**Declared but inert in step 1:** `prompts` and both `answer` forms. A declaration carrying prompts is
**rejected with a clear error** — never accepted and silently ignored.

**Out, named:**

- `askHuman` implementation and the control-plane answer call (step 2) — the SerproID
  user+password+MFA rung.
- Supervision (step 3) — and per D13 it is **not** a Rust twin of `superviseConnection`'s
  reconnect-on-drop. It is: probe truthfully, re-establish silently when no human is needed, and
  otherwise park in `needs-attention` holding one acknowledged request. The existing blind-retry
  behaviour is the thing being replaced, not ported.
- `secretRef` resolution — **open question**, see below.
- A guest consumer proof (needs `cargo component build`).
- The remote surface (the original slice 3).
- B′ — the sidecar as the single tailnet front door.

## Placement rule

Per the operator: when it is not yet clear where something belongs in Refarm, it stays **intended in
rcdc5**, which is the representative workspace; if something is genuinely a Refarm default, better
still. Applied here: the connection **engine**, the config schema, and the claim model are Refarm
defaults; the `serpro-vpn` adapter binary and any SerproID-specific pattern data stay in rcdc5, named
by an operator declaration.

## What this unlocks

The corner this postpones gets cheaper, not later. Slice 3's hard parts already exist: `stream:v1`
supplies the frame contract with a `sequence` cursor, and the transports are already built and
conformance-tested — `sse-stream-transport`, `ws-stream-transport`, `file-stream-transport`, plus
`stream-follower` as the client half. A remote surface over `stream:v1` inherits SSE **and** WebSocket
without choosing between them, which was the operator's long-term concern.

Decisions already taken for that corner, recorded so they survive:

- **Remote blast radius**: opt-in **per declared command** (`remote: true` on a `commands` entry),
  default local-only. Extends "catalog, not a shell" to the network rather than reinventing it there.
- **Bind posture**: a short ladder with the safe mode as default — discover the tailnet IP and bind
  exactly to it, fail-closed (never falling back to a wider exposure); `--host <ip>` validated against
  the tailnet as the manual mode; a per-request peer filter only as an explicitly named escape hatch.
  Measured on this machine: `tailscale ip -4` returns a tailnet address.
- **Auth**: reuse `.refarm/auth-policy.json` (SHA-256 of a per-device bearer, minted by
  `refarm auth enroll`). The TS `refarm serve` has **no gate today**, while the Rust sidecar does
  (`packages/tractor/src/sidecar/auth.rs`); its two fail-closed rules must be preserved by any second
  implementation — policy absent ⇒ gate off; policy present but unreadable ⇒ **deny-all**. A
  conformance test over shared fixtures keeps the two doors from diverging.
- **Layering**, already stated by `auth.rs`: the tailnet authenticates the device to the **network**;
  the token authenticates it to the **farm**. They are not redundant.

## Open questions

1. **`secretRef` resolution from Rust.** `silo` is TS (`packages/silo/src/index.js`); the Rust host
   cannot reach it. Secrets arrive host-side today through the `sensitive_aliases` path used for model
   credentials. Options: bridge to silo over the sidecar, extend the sensitive-alias mechanism, or
   resolve from a policy file. Deferred — **step 1 needs no secret at all**, because the Serpro VPN
   authenticates with a certificate plus a phone push.
2. **Where the `answer-prompt` control call lives** on the sidecar, and how it is authenticated (it
   should reuse the same device-auth gate).
3. **Whether a connection can depend on another** — a SerproID platform session that requires the VPN
   to be up first. The claim model makes this expressible (`requires: ["serpro-vpn"]` in a
   declaration), but it introduces ordering and cycle detection. Deferred until a second connection
   exists to prove the need.
