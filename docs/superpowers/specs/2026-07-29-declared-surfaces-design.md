# Declared surfaces — one place to say how this node is reachable

Date: 2026-07-29
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — machine empowerment / exposure

## Why, and why it took six tripwires to see

The operator named it: *"footguns e falta de coesão no DX para declarar e intencionar coisas
multi-superfície"*. The listener inventory taken while closing a live exposure is the literal proof.

| surface | how it decides where it listens | who may reach it |
| --- | --- | --- |
| daemon HTTP sidecar (Rust) | `--http-host`, default loopback | opt-in bearer middleware |
| daemon CRDT/agent WS (Rust) | **`0.0.0.0` hardcoded** | nothing verifies |
| `serveCapabilities` (the SDK primitive) | **no host option at all** | nothing verifies |
| farmhand CRDT relay | `{ port }`, every interface | nothing verifies |
| `refarm serve` | `--host` | nothing verifies |
| `refarm web serve` | `--host`, and proxies `/sync` to the daemon WS | nothing verifies |

**Six surfaces, six independent decisions about reachability, no shared declaration.** Each was
written by someone solving their local problem, and nothing ever forced any of them to answer, in
one place: *how is this node reachable, and who may reach it?*

So the footguns were not bad luck. They are the symptom of the missing declaration, and it took
tripping over its absence six times for the pattern to be visible. Fixing six binds one at a time
treats the symptom; the seventh surface someone writes would arrive open again.

## The shape, and why it matches what already works here

Refarm already declares three things well, in one file, with one doctrine — *the operator states
intent as data; the runtime interprets it; anything undeclared is refused*:

- `connections` — the long-lived resources this machine offers.
- `commands` — the named operations a workspace exposes (an operation catalog, never a shell).
- `capabilities.requiresConnections` — what a plugin expects before it runs.

**Exposure is the fourth, and it is missing.** It belongs in the same file, in the same shape:

```jsonc
// .refarm/config.json
"surfaces": {
  "sidecar-http":  { "expose": "loopback" },
  "daemon-ws":     { "expose": "loopback" },
  "capabilities":  { "expose": "tailnet", "gate": "device-token" },
  "web":           { "expose": "loopback" }
}
```

### S1 — Undeclared means closed, and that is the absence of a value, not a default someone typed

A surface nobody declared binds loopback. This is the property that would have prevented every
finding in the table above: the daemon WS was never *decided* to be open — it was written open, and
no declaration existed to contradict it. Making closed the meaning of *silence* is stronger than
making it the meaning of a default, because a default can be overwritten by the next person solving
their local problem.

### S2 — `expose` is intent, not an address

`loopback` | `tailnet` | `host:<ip>`. The operator says what they mean; the runtime resolves it.

`tailnet` carries the decision already taken and signed off: discover this machine's tailnet address
and bind exactly to it, **fail-closed** — if the tailnet is unavailable, refuse to start rather than
falling back to something wider. A literal IP in config rots the day the address changes, and rots
silently, which is the worst kind.

`host:<ip>` stays available for the cases discovery cannot serve (a container, a second NIC), and it
is validated, not trusted.

### S3 — A gate is required for anything that is not loopback, and a surface cannot declare a gate it does not have

This is the rule that closes the hole the bind guard could not. Today, a policy file present makes
the guard approve a non-loopback WS bind — but the WS has **no middleware behind it**, so the guard
grants permission for something it does not gate. A guard that says yes to what it cannot enforce
reads as safety and is not.

So the declaration is validated against what each surface can actually enforce. `daemon-ws` may
declare only `loopback` until ADR-093's credential handshake lands; declaring `tailnet` for it is a
**configuration error**, refused at load with the reason. When the handshake ships, the surface's
capability changes and the same declaration becomes legal — the config did not change, the truth
did.

**Update (2026-07-29):** ADR-093's `/sync` WebSocket handshake shipped. `daemon-ws` now enforces
`device-token` exactly like `sidecar-http` (`surface_enforceable_gate` in
`host_effects_bridge/surfaces_decl.rs`), so it may declare `"expose": "host:<ip>", "gate":
"device-token"` — validated at load AND, since `sidecar::bind_guard::
refuse_unguarded_nonloopback_ws_bind` was promoted to the same declaration-aware shape the sidecar
uses, at bind time. `tailnet` stays refused for both surfaces (open question 1 below is still
open); only `host:<ip>` widened.

### S4 — One resolver, several runtimes

Rust and TypeScript both read this block, exactly as both read the permission vocabulary today. That
carries the same drift risk, and therefore the same remedy the permission vocabulary already uses: a
single source of truth plus a CI guard that fails when the two disagree
(`scripts/ci/check-permission-vocab.mjs` is the working precedent, and the TS bind guard in
`@refarm.dev/std` already mirrors `bind_guard.rs`).

### S5 — The guard becomes enforcement of a declaration, not a rule of its own

The fail-closed bind guard built while closing the live exposure is not replaced — it is *promoted*.
Today it answers "is this host loopback, and is a policy present?". Under this design it answers
"does the declaration permit this bind, and can this surface enforce what the declaration claims?".
Same doctrine, better question, and one place to change it.

## What this buys the operator

The DX the operator asked for, stated concretely: **"expose me on the tailnet" becomes one word per
surface, in the file where everything else about this machine is already declared** — instead of
knowing six flags across two languages and one shell script, and being silently wrong about the two
surfaces that never had a flag at all.

And it composes with the mesh channel: that work needs *one declared door* to cross, rather than six
to audit. `surfaces` is what makes the exposure reviewable in a glance instead of a sweep.

## Open questions

1. ~~**Who resolves `tailnet`, and how?** The Rust daemon has no Tailscale dependency. Shelling out to
   `tailscale ip -4` is a spawn from inside the host; reading the interface directly avoids the
   spawn but couples to the interface name. Neither is obviously right, and the choice affects the
   fail-closed promise: whatever resolves it must distinguish "the tailnet is down" from "I could not
   ask", exactly as the connection probe distinguishes `down` from `unknown`.~~ **Answered**
   (2026-07-29): `tailscale status --json`, not `ip -4` or reading the `tailscale0` interface — it is
   the only one of the three that explains ITSELF (its `BackendState` field names why, where a bare
   exit code or an absent interface cannot). `sidecar::tailnet_resolve` (`packages/tractor/src/
   sidecar/tailnet_resolve.rs`) is a PURE classifier over the parsed JSON plus a thin injectable
   fetcher, so every scenario is tested against real/realistic fixtures with no process ever spawned
   in a test. It resolves `SurfaceExpose::Tailnet` into `SurfaceExpose::Host(<ip>)` BEFORE
   `sidecar::bind_guard`'s pure guard functions ever run, so those stay exactly as pure as they
   always were — resolution decides WHERE, the guard still decides WHETHER. Two distinguishable
   refusals, matching the connection engine's `down`/`unknown` split: `TailnetRefusal::Down` (a
   complete, trustworthy answer that isn't usable — not `Running`, not `Online`, or no IPv4 address)
   vs `TailnetRefusal::CouldNotAsk` (no trustworthy answer at all — missing binary, spawn/timeout
   failure, or an unexpected shape), each with an operator-facing message naming the opposite remedy
   (fix the tailnet vs fix the local invocation). Bound with a 2s timeout, treated as `CouldNotAsk`.
   Resolution is skipped entirely — no spawn, no latency — when a `--http-host`/`--ws-host` flag is
   already narrowing to loopback (S5 must still hold even when Tailscale isn't installed at all,
   e.g. in a container). `Self.Online: false` while `Running`, and an IPv6-only address, both
   bucket as `Down` (a complete answer that just isn't bindable right now) — see that module's doc
   for the reasoning on both.
2. **What does `gate: "device-token"` mean on a TypeScript surface?** Today no Node surface verifies
   a bearer at all — the TS bind guard shares the bind rule, not the authentication. Either the TS
   surfaces gain a verifier reading the same `.refarm/auth-policy.json` the Rust side reads, or
   `device-token` is declarable only on surfaces that can enforce it, per S3. The second is honest
   and smaller; the first is where it has to end up.
3. ~~**Does `surfaces` subsume the existing flags** (`--http-host`, `--host`, `--ws-host`), or do they
   remain as overrides? An override that can widen a declaration reopens the hole; an override that
   can only narrow it is safe and useful for a container.~~ **Answered** (2026-07-29, the "reachable"
   follow-up): they remain as overrides, narrow-only — but getting there required noticing that the
   Rust CLI flags were never actually optional. `--http-host`/`--ws-host` carried `default_value =
   "127.0.0.1"`, so the flag ALWAYS held a value, and under S5 a present value always narrows — so a
   `surfaces.sidecar-http` declaring `host:<ip>` could never take effect; the whole slice was inert
   for that surface and nothing said so. The general lesson: **under a narrowing rule, a CLI default
   stops being neutral** — a default value is indistinguishable from an explicit operator choice.
   Both flags are now `Option<String>` with no default: absent means "the declaration decides",
   present means "the operator is narrowing" (`sidecar::bind_guard::resolve_sidecar_bind_host` /
   `resolve_ws_bind_host`). This is also what let `scripts/tractor-start.sh` stop synthesising a
   `surfaces.sidecar-http` declaration at container boot (it used to read-then-write
   `.refarm/config.json` with `jq`, inverting the "operator states intent as data" doctrine this
   design rests on) — a container now gets loud guidance plus
   `docs/container-surfaces.example.json` to copy in, not an auto-authored declaration.

## First slice, when this is taken

Not the whole model. The smallest thing that makes the next surface arrive closed: the `surfaces`
block, S1 (undeclared ⇒ loopback), S3's validation (a surface may not declare a gate it cannot
enforce), and the existing guard rewired to read it — starting with the two Rust listeners, whose
enforcement already exists. The TypeScript surfaces follow once question 2 is answered, and they are
the reason question 2 must be answered rather than deferred.
