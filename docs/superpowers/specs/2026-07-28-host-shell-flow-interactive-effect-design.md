# `host-shell-flow` — a conversational, long-lived shell effect

Date: 2026-07-28
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — machine empowerment / operate-model

## Why this, and why now

The lane's next corner was slice 3: expose `refarm workspace run` over HTTP on the tailnet so a
phone can operate a declared workspace command. Interviewing the operator moved the work **down a
layer** instead, for a reason worth recording.

The first operated command is `serpro-vpn connect` — an adapter over `@refarm.dev/login-flow` that
drives the real `ovpnctl`. It is live-proven from the CLI. But the operator's actual direction is
larger than one command: the SerproID login is the gate of **many** SERPRO platforms, not just the
ALM, and the ladder is QR → user+password+MFA (obfuscated) → configuration wizards, always with the
generic part in Refarm and the specific part in its workspace. Interactive login is therefore a
**substrate concern**, not a VPN feature.

That reframing exposed a gap. Asked whether Tractor was deficient, the honest answer is no — and
the plugin intuition was right. Tractor already grants plugins a shell effect
(`host-shell.spawn`, `packages/plugin-wit/wit/host.wit:95`; host impl at
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

So the VPN cannot be a sandboxed plugin today — not because of a design deficiency, but because the
effect contract is mute and ephemeral while the operation is conversational and long-lived. This is
the same host-effect gap the lane already recorded from the scraping side.

Cultivating this effect also **cheapens** the corner it postpones: see "What this unlocks".

## Decisions

### D1 — A separate interface with its own capability

`host-shell-flow` is a new interface, not new functions on `host-shell`. Holding a process alive
while conversing with it is strictly more authority than a batch spawn, so enabling one must not
silently enable the other. It gets its own `shell:flow` permission.

`Permission` (`packages/tractor/src/host/permission.rs:38`) classifies `ShellSpawn` as
`RiskLevel::High` ("executes arbitrary code / commands"). `ShellFlow` is also High. The enum has no
axis for the dimension that actually differs — **duration** — so that risk is controlled by
ownership and ceilings (D5), not by a new risk class.

### D2 — The host drives the loop; the plugin declares the script

The plugin passes the script (ready / fail / prompt / notice rules) in one call; the host runs the
state machine. Rejected alternative: a raw session pipe (`open`/`read`/`write`/`close`) with the
plugin running its own expect-loop.

Rationale:

- It mirrors the boundary the repo already chose for long-running streamed work:
  `model-bridge::complete-http-stream` (`packages/plugin-wit/wit/host.wit:63`) is one blocking guest
  call while the host streams and returns a cursor-bearing result.
- It preserves the doctrine written at `packages/plugin-wit/wit/host.wit:40` — *"credentials stay in
  the host process (plugin never reads provider API keys)"*. A plugin-driven loop would carry every
  secret **through** the plugin on its way to stdin.
- The repo's WIT uses flat functions and ids; there are **no** component-model `resource` types
  anywhere in it today. A session-pipe design would introduce that idiom.

Accepted loss: conversation logic that cannot be expressed as pattern rules. The batch `spawn` still
exists for one-shot needs, and rules extend additively. If a real case ever needs full conversational
control, a plugin-driven variant is the escape hatch — with the known cost of secrets crossing into
the plugin.

### D3 — `ask-human` is in the contract from day one, implemented in step 2

`answer-source` is a variant with `secret-ref` and `ask-human`. WIT is the expensive thing to change;
implementations are not. Declaring both now costs nothing and guarantees the MFA rung does not force
a contract change later.

### D4 — Regex matching, not substring

Substring matching would have avoided a new dependency (`regex` is **not** currently a Tractor
dependency) and would have removed ReDoS risk by construction. The operator chose regex, and there is
a strong supporting argument: `login-flow` matches with JS `RegExp`, so a substring-matching Rust
twin would make **shared conformance vectors meaningless** (D9).

The Rust `regex` crate is linear-time with no backtracking, so a plugin-supplied pattern cannot
ReDoS the host. It does **not** support lookahead/lookbehind or backreferences — shared vectors must
stay inside the subset both engines accept. Pattern count and length are capped, and a pattern that
fails to compile is a clean error, never a panic.

### D5 — Held sessions have an owner and a ceiling

`hold-after-ready` leaves the process running and returns a session id. Held sessions live in a
per-plugin-instance registry; unloading or revoking the plugin **kills** them. This mirrors
`superviseConnection`'s own rule ("owns the process, no orphan"), moved to the host side, and is what
prevents a revoked plugin from leaving a tunnel standing. Concurrent held sessions per plugin are
capped.

### D6 — The result carries a cursor, never a transcript

Batch `spawn` returns `stdout: list<u8>`. `run-flow` returns `last-sequence` and no output. A
long-lived process has no "end" at which to accumulate, and a returned transcript is one more place
sensitive text can escape. Output travels only over `stream:v1`. This matches
`stream-response-result` (`packages/plugin-wit/wit/host.wit:49`).

### D7 — Output rides the existing `stream:v1` contract; no new schema

`packages/stream-contract-v1/src/types.ts` already defines exactly the frame this needs:

```ts
interface StreamChunk {
  stream_ref: string; sequence: number; is_final: boolean;
  payload_kind?: "text_delta" | "final_text" | "final_tool_call" | "final_empty" | "error";
  metadata?: unknown;
}
```

On the Rust side, `StreamChunkObservationDraft`
(`packages/tractor/src/streaming/observations.rs`) types `payload_kind` as `String` and `metadata`
as `serde_json::Value`. The new `"notice"` and `"prompt"` kinds are therefore **data, not schema** —
no Rust type changes. Only the optional TS union gains the two variants, additively.

`StreamSessionObservationDraft` carries `stream_kind` (`"shell-flow"`), status, and `last_sequence`.
`node_reap.rs:119-120` already refuses to sweep a non-terminal `StreamSession`, so a live tunnel's
session is not garbage-collected — behavior inherited, not invented.

### D8 — Prompt answers arrive through the host control plane, not through WIT

While a prompt is pending, the guest is **blocked inside `run-flow`**, so it cannot answer. The
answer therefore enters through the host's own surface (a sidecar call), keyed by `prompt_id`. This
is not a workaround: it is precisely the seam that later lets a phone answer an MFA prompt without
the plugin knowing a phone exists.

Abandonment is mandatory: `prompt-timeout-ms` expiring kills the process and settles the flow as
`timeout`. Never wait forever.

### D9 — Two twins, kept honest by shared vectors

`login-flow` (TS, for host-side callers such as today's `serpro-vpn`) and `host-shell-flow` (Rust,
for sandboxed plugins) are two implementations of one state machine. This is accepted because they
serve different callers, and mitigated by a shared JSON vector file — (output chunks + rules) →
(expected event sequence) — executed by both suites.

## The contract

New interface in `packages/plugin-wit/wit/host.wit`, added to the `effect-capable` and `host-plugin`
worlds in `packages/plugin-wit/wit/worlds.wit`.

```wit
/// Conversational, long-lived shell effect. Complements `host-shell.spawn`
/// (batch, mute, ephemeral) for processes that CONVERSE and that must stay
/// alive after reaching a ready state — a VPN client holds the tunnel only
/// while it runs. Gated on its own `shell:flow` capability: holding a live
/// process is strictly more authority than a one-shot spawn.
interface host-shell-flow {
    /// How a prompt is answered. The plugin declares WHICH answer, never the value.
    variant answer-source {
        /// Host resolves the secret by reference; the plugin never sees it.
        secret-ref(string),
        /// Host publishes a `prompt` frame and blocks for a human answer.
        ask-human(string),
    }

    record prompt-rule { pattern: string, answer: answer-source, label: string }
    record notice-rule { pattern: string, message: string }

    record flow-request {
        argv: list<string>,
        env: list<tuple<string, string>>,
        cwd: option<string>,
        /// Pattern meaning "reached the connected/ready state".
        ready: string,
        fail: option<string>,
        prompts: list<prompt-rule>,
        notices: list<notice-rule>,
        /// Where frames are published (a stream:v1 stream_ref).
        stream-ref: string,
        /// Publish raw process output as `text_delta` frames. Default OFF:
        /// notices are the curated channel; raw output is noise and leak surface.
        publish-output: bool,
        /// Wait this long for `ready` before killing and failing.
        ready-timeout-ms: u32,
        /// Wait this long for an unanswered `ask-human` prompt before failing.
        prompt-timeout-ms: u32,
        /// Leave the process RUNNING after ready (the held-connection case).
        hold-after-ready: bool,
    }

    enum flow-reason { ready, fail, timeout, exit }

    record flow-result {
        reason: flow-reason,
        /// Present only when held and reason == ready.
        session: option<u64>,
        /// Cursor of the last published frame (the resume point).
        last-sequence: u32,
        exit-code: option<s32>,
    }

    run-flow: func(req: flow-request) -> result<flow-result, string>;
    close:    func(session: u64) -> result<_, string>;
    alive:    func(session: u64) -> result<bool, string>;
}
```

## Host implementation

New file `packages/tractor/src/host/host_effects_bridge/flow.rs`, included from
`host_effects_bridge.rs` beside `core.rs` / `policy_and_fs.rs` / `capability_tools.rs` — the split
the module already practices.

It reuses the existing guards **without exception**: `enforce_permission`,
`enforce_trusted_plugin_for_shell_with`, `enforce_shell_allowlist`, `enforce_spawn_env`,
`enforce_spawn_cwd`. The new effect is another door in the same corridor, never a parallel corridor.

- **Accumulating buffer with a hard cap.** Matching cannot be line-based (a prompt may have no
  trailing newline), so patterns are matched over accumulated text, capped in bytes. Each rule fires
  once per occurrence.
- **Answers are write-only.** A prompt answer is never logged, never published as a frame, never
  retained in the published buffer — the guarantee `login-flow` states at
  `packages/login-flow/src/index.ts:89`, and the reason `secret-ref` is a reference and not a value.
- **Injectable process spawn**, mirroring `login-flow`'s `spec.spawn`, so the state machine is
  unit-tested against a fake — no real process, no network, no external binary.

Permission plumbing: `Permission::ShellFlow` in `packages/tractor/src/host/permission.rs`, mirrored
in TS at `packages/plugin-manifest/src/permission-vocab.js` and the union in
`packages/plugin-manifest/src/index.d.ts`. **`packages/plugin-manifest/**` is a protected surface
under CLAUDE.md §8** — that edit requires explicit operator confirmation, not routine application.

## Testing and validation economy

Host-effect tests construct `TractorNativeBindings` directly and call the `Host` trait impls
(the pattern in `packages/tractor/src/host/host_effects_bridge_tests/fs_shell_core.rs`). **No WASM
component is involved**, so this slice validates cheaply:

```bash
cargo check --quiet -p tractor
cargo test --lib flow --quiet
```

`cargo component build` is **not** part of this slice; it is needed only when a real plugin consumer
exists, which is a separate step (CLAUDE.md §7 — pay for signal, not repetition).

Coverage to write:

1. ready reached → `flow-reason::ready`, terminal frame `is_final`, process killed when not held.
2. `hold-after-ready` → process alive, `session` returned, `alive` true, `close` kills it.
3. plugin unload → held sessions killed (no orphan).
4. fail pattern → `fail`, session status `failed`.
5. `ready-timeout-ms` → `timeout`, process killed.
6. notice rule → a `notice` frame with the human message; fires once per occurrence.
7. `publish-output: false` → no `text_delta` frames; `true` → output published.
8. a request carrying any `prompt-rule` → rejected with a clean "answer source not implemented yet"
   error (step 1 has no answer path; it must refuse, never silently skip the prompt).
9. guards: missing `shell:flow`, untrusted plugin, argv outside allowlist, cwd outside root, bad env.
10. invalid regex → clean error; oversized pattern set → rejected; buffer cap respected.
11. sequence numbers strictly increasing across all frames of one `stream_ref`.
12. shared conformance vectors pass identically in Rust and in `login-flow`'s TS suite.

Step 2 adds: a `prompt` frame published on match; `prompt-timeout-ms` settling an unanswered
`ask-human` as `timeout`; and the control-plane answer call.

## Scope

The contract below is complete in **step 1**; two of its behaviors are not.

**In (step 1):** the WIT interface as written; `flow.rs`; the `shell:flow` permission and its TS
mirror; `notice` / terminal frames over `stream:v1`; `hold-after-ready` with owned sessions; the
tests above; docs. This covers the Serpro VPN end to end, because it authenticates with a
certificate plus a phone push and prompts for nothing.

**Declared but inert in step 1:** `prompts`, `answer-source` (both variants), and
`prompt-timeout-ms`. A `flow-request` carrying a prompt rule is **rejected with a clear error** —
never accepted and silently ignored, which would let a login hang on an unanswered prompt.

**Out, named:**

- `ask-human` implementation (step 2) — the contract is present, the behavior is not.
- `secret-ref` resolution — **open question**, see below.
- A guest consumer proof (needs `cargo component build`).
- The remote surface (the original slice 3).
- B′ — the sidecar as the single tailnet front door.

## What this unlocks

The corner this postpones gets cheaper, not later. Slice 3's hard parts turned out to already exist:
`stream:v1` supplies the frame contract with a `sequence` cursor, and the transports are already
built and conformance-tested — `sse-stream-transport`, `ws-stream-transport`,
`file-stream-transport`, plus `stream-follower` as the client half. A remote surface built on
`stream:v1` inherits both SSE and WebSocket without choosing between them, which was the operator's
long-term concern.

Decisions already taken for that corner, recorded so they survive:

- **Remote blast radius**: opt-in **per declared command** (`remote: true` on a `commands` entry),
  default local-only. Extends "catalog, not a shell" to the network rather than reinventing it there.
- **Bind posture**: a short ladder with the safe mode as default — discover the tailnet IP and bind
  exactly to it, fail-closed (never falling back to a wider exposure); `--host <ip>` validated against
  the tailnet as the manual mode; a per-request peer filter only as an explicitly named escape hatch.
  Measured on this machine: `tailscale ip -4` → a tailnet address is available.
- **Auth**: reuse `.refarm/auth-policy.json` (SHA-256 of a per-device bearer, minted by
  `refarm auth enroll`). The TS `refarm serve` has **no gate today**, while the Rust sidecar does
  (`packages/tractor/src/sidecar/auth.rs`); its two fail-closed rules must be preserved by any second
  implementation — policy absent ⇒ gate off; policy present but unreadable ⇒ **deny-all**. A
  conformance test over shared fixtures is what keeps the two doors from diverging.
- **Layering**, already stated by `auth.rs`: the tailnet authenticates the device to the **network**;
  the token authenticates it to the **farm**. They are not redundant.

## Open questions

1. **`secret-ref` resolution from Rust.** `silo` is TS (`packages/silo/src/index.js`); the Rust host
   cannot reach it. Secrets arrive host-side today through the `sensitive_aliases` path used for
   model credentials. Options: bridge to silo over the sidecar, extend the sensitive-alias mechanism,
   or keep `secret-ref` host-resolved from a policy file. Deferred — **step 1 needs no secret at
   all**, because the Serpro VPN authenticates with a certificate plus a phone push.
2. **Where the `answer-prompt` control call lives** on the sidecar, and how it is authenticated
   (it should reuse the same device-auth gate).
3. Whether `flow-reason` should distinguish a prompt timeout from a ready timeout. Currently both
   settle as `timeout`; the frame metadata carries the distinction.
