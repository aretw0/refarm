# Declared processes — refarm owns the declaration, the host may own the act

Date: 2026-07-30
Status: **First slice implemented** (2026-07-31) — see [First slice](#first-slice) below
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — substrate
Triggered by: *"P6 when refarm supervises a process it owns"* —
[`2026-07-29-process-administration-layer-design.md`](2026-07-29-process-administration-layer-design.md)

## What forced this

`refarm web serve` — the mesh distribution server the operator's phone bootstraps from — is running
in a `nohup`'d background shell. Nothing supervises it, nothing restarts it, and `refarm runtime
status` does not know it exists. If it dies, cold bootstrap and `farm-update` stop working and
nobody is told.

The 07-29 design listed P6 as out of scope with an explicit trigger: *when refarm supervises a
process it owns*. That trigger has fired.

The operator added the constraint that shapes this document:

> *"se puder trazer quem vai supervisionar caso possamos terceirizar o ato sem precisar acoplar ao
> tractor, mas se for necessário ele assume mesmo"*

## W1 — The declaration is refarm's; the supervision act may be borrowed

`connections` and `surfaces` established the split: the operator declares intent as data, the runtime
interprets it. `processes` is the third catalog under the same doctrine — command, liveness probe,
restart policy, all declared.

What is *new* here is that the **act** need not be refarm's. Every host already has a supervisor:
`systemd --user` on most Linux (measured running on the operator's node, with existing user units),
`launchd` on macOS, runit under `termux-services` on Android. Reimplementing supervision inside
tractor when the host ships a battle-tested one would be the reinvention this repo keeps refusing.

So: **refarm resolves a supervision backend** to satisfy a declared intent. That is detection used
correctly — it decides *how* to satisfy what the operator declared, never *what* they wanted.

## W2 — Borrowing a supervisor means changing the operator's machine, so it goes through consent

A systemd backend writes a unit file into `~/.config/systemd/user/`. That is a durable change to the
operator's computer, made on their behalf — precisely what
[`2026-07-30-operation-consent-and-record-design.md`](2026-07-30-operation-consent-and-record-design.md)
covers. `processes` becomes the **third consumer** of `@refarm.dev/operation-consent-v1`, and the
first that genuinely needs the *prompt* rather than only the record: the operator has not typed this
change themselves, something proposed it for them.

Everything R3 requires applies: the exact unit file shown before the decision, the record carrying
before/after, and an undo that actually removes what was installed.

## W3 — The request must state the limitation, not just the benefit

Measured on the operator's node: `Linger=no`. A `systemd --user` unit **stops when they log out**
unless lingering is enabled, and enabling it (`loginctl enable-linger`) is a second change to their
machine.

A request that says "I will keep this running" while omitting that it dies at logout has told a
useful-sounding untruth. The proposal must state the lifetime it actually delivers, and offer
lingering as a **separate, separately-authorised** operation — never bundled, because bundling is how
a small yes becomes a large one.

This is [R2](2026-07-30-operation-consent-and-record-design.md) with teeth: the operator authorises a
specific change, having been shown enough to judge it.

## W4 — A service is an end; a connection is a means

`connections` already does most of the mechanics — declared command, spawn, readiness probe, shared
registry, lifecycle. The temptation is to declare a long-running server "a connection that never
ends".

Refuse it. A connection is a **means**: it is opened so something else can happen, several
interested parties may share one, and it carries claim/release semantics that decide when it may
close. A service is an **end**: it exists to answer, nobody "claims" it, and release means nothing.
Folding the second into the first inherits a lifetime model that does not apply — which is how
process supervisors historically grew into things nobody can explain.

Share the mechanics where they genuinely coincide (spawn, probe, the derived environment of P10).
Do not share the vocabulary.

## W5 — Tractor is the fallback, and the fallback must exist

Not every host has a borrowable supervisor. Termux has no systemd, and the phone is a first-class
target here.

So tractor supervising a process directly stays in the design as the fallback — but it is the
fallback, taken when no host supervisor is available, not the default. `packages/tractor/src/respawn.rs`
already holds supervision *policy* (what to restart, an anti-hot-loop cooldown) for WASM plugins; its
shape is the precedent, its target is not.

## First slice

`refarm web serve` under a systemd user unit on the operator's node, declared in `processes`,
proposed through the consent block with its lifetime stated honestly, and recorded with a working
undo. This slice touches **no protected surface**: the node has systemd, so the act is borrowed and
tractor is not involved.

W5's fallback lands when a supervised process is needed on a host without a supervisor — the phone,
most likely, and that is the moment tractor takes it on.

### What shipped, 2026-07-31

Two blocks and one command:

- **`@refarm.dev/process-contract-v1`** — the `processes` catalog (W1), fail-shut like
  `parseSurfaces`, with `restart` **required** rather than defaulted. Four-valued status: `running`,
  `not-running`, `not-declared`, `could-not-ask`. `resolveSupervisionBackend` is W1's detection —
  deciding *how*, never *what* — and refuses honestly on a host with no borrowable supervisor.
- **`@refarm.dev/process-systemd-user`** — the borrowed act. Renders the unit, probes state
  read-only, and builds the consent request (W2) whose undo removes the file. W3 is enforced
  structurally: `describeUnitLifetime` states the *measured* lifetime, and `refuseBundledLinger`
  makes bundling lingering into a unit installation impossible in both directions.
- **`refarm process list|status|install|uninstall|linger`** — the operator surface.

**The Rust side needed to learn nothing.** `refarm_config_json_from`
(`packages/tractor/src/host/plugin_host/env_and_runtime.rs`) parses the file into an untyped
`serde_json::Value`, and each consumer (`revokedPlugins`, the config node) reads its own key. There
is no top-level allowlist, and `redact_config` walks the tree generically rather than filtering by
known key, so a new `processes` block flows through untouched. `packages/tractor/**` is unmodified
by this slice.

**What this deliberately does NOT do:** it never runs `systemctl --user enable/start/stop`. refarm
writes the unit through consent and hands the activation line to the operator — the boundary
`refarm cert trust` already draws. And it adds **no SIGTERM handling** to `packages/tractor/`:
`TimeoutStopSec` gives ordered termination from the supervisor today, which is exactly W1's
"borrow the act". Teaching the runtime and `web serve` to handle the signal is a follow-up that
makes the wait *productive* rather than making it *exist*.

**The declaration an operator writes** (`.refarm/config.json`):

```json
{
  "processes": {
    "web-serve": {
      "description": "the mesh distribution server the phone bootstraps from",
      "command": [
        "/home/<you>/.local/bin/refarm",
        "web",
        "serve",
        ".refarm/dist/farm-client",
        "--port",
        "4321"
      ],
      "workingDirectory": "/home/<you>/github/refarm",
      "restart": "always",
      "stopTimeoutSeconds": 20
    }
  }
}
```

`command` is an **argv, not a shell line** — a string is refused, because splitting one is a
quoting bug waiting for a path with a space in it. `command[0]` must be absolute: systemd does not
search `PATH`, and the refusal names `command -v refarm`.

The **second passenger** the design names is certificate renewal — a `tailscale cert` or local-CA
renewal is a supervised process under the same catalog, with `restart: "on-failure"`.
