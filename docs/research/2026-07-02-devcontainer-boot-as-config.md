# Direction: the devcontainer boot as refarm config + primitive (convergence)

> Feedback/direction. Everything done in refarm should **converge into its own configuration** — start from
> refarm's declared intent, not external ad-hoc shell. The devcontainer boot (`post-start.sh`) is currently
> hand-coded shell, and its footguns are symptoms of that. This proposes converging it, following the
> pattern `environmentCeilings` already set.

## The symptom that surfaced it

`post-start.sh` guarded a script with `[ -x "$ROOT/scripts/env-safety-check.sh" ]`. On a Windows bind mount
the execute bit is not preserved, so the guard fell through and **silently skipped the safety check** (and
printed a false "missing"). Patched to `[ -f ]` (`b913dc1f`) — correct, but it is a **hand-coded shell
guard**: the wrong layer. A refarm boot primitive would run declared lanes cross-platform without anyone
re-discovering the `-x` footgun.

## The principle (why refarm exists)

Refarm wants to be **the interface for everything one can declare** — intention + configuration — the place
that **shows how to wire it all**, and the **SDK to build on**. So machinery that lives as ad-hoc shell
external to that domain is a convergence gap. The rich package set is the expression of this: primitives
declare, config drives, the runtime wires.

`environmentCeilings` is the model already in place: **declared** in `refarm.config.json`, **normalized** by
`@refarm.dev/config/environment-ceilings`, **consumed** by `.devcontainer`, remote nodes, and future
watchdogs — one source of truth. The boot lanes should follow the same shape.

## The convergence

1. **Declare the boot lanes in `refarm.config.json`** — a `devcontainerBoot` (or `bootstrap`) section
   listing the lanes each start runs: env-safety, ownership/workspace-protect, agent-env checks, and
   (future) the commons watchdog. Each lane: `{ id, script | command, mode: "warn"|"strict", when:
   "every-start"|"create" }`.
2. **Normalize via `@refarm.dev/config`** — a `bootstrap` normalizer, product-neutral, so `.devcontainer`,
   remote nodes, and CI read the same declaration.
3. **A refarm boot runner** (`refarm devcontainer boot`, or a small `@refarm.dev/*` primitive) executes the
   declared lanes: resolves each script, runs via the interpreter (no reliance on the bind-mounted execute
   bit — the `-x` footgun cannot recur), honors `mode`, logs to the `TelemetryBus`.
4. **`post-start.sh` becomes thin** — it calls `refarm devcontainer boot` (or the runner), no per-lane
   shell logic. And per the watchdog plan, the must-run-on-every-start lanes move to the **entrypoint** so a
   Docker Desktop bring-up (no VS Code) still runs them — the config's `when: "every-start"` maps there.

## Payoffs

- **Footguns move into the primitive, once.** The `-x`/bind-mount handling, the run-via-interpreter, the
  mode/telemetry — solved in one runner, not re-hand-coded per shell script.
- **The boot is declarable + inspectable + testable** — a config, conformance-checkable like the ceilings
  contract (`test-devcontainer-contract.mjs`), not opaque shell.
- **One declaration, many environments** — local devcontainer, remote nodes, CI all consume it, exactly as
  `environmentCeilings` does.
- **It is refarm being its own interface** — the boot starts from refarm's config, not external to it.

## Beyond boot — the full devcontainer workflow as a primitive

The same convergence covers more than boot. The `farm` helper (`.devcontainer/farm`) — "enter as the dev
user from a Docker Desktop root terminal" — is a **generic devcontainer-workflow need**: agents-lab has its
own (`lab`). `farm` mixes generic mechanics (switch to the dev user, with a `node` fallback; assemble the
shell env — HOME/USER/locale/PATH/package-manager homes; `cd` the workspace; run interactive or a command)
with project specifics (the `REFARM_*` env, the name, the cargo/rust paths, the locale).

The convergence mirrors the boot:

- **A generic `enter` primitive** (refarm) — user switch + shell-env assembly + workspace `cd` + run. No
  project strings baked in.
- **The project env declared in `refarm.config.json`** (`devcontainer.env`) — the helper injects the
  declared vars, so `REFARM_*` (or any project's vars) come from config, not a hand-written heredoc.
- **The name via `toolbox`/rebrand** — `farm` / `lab` is a white-label alias of the generic `enter`. This is
  exactly what refarm's white-label exists for; the per-project name is a rebrand, not a fork.

So the "refarm devcontainer" primitive is a small family — **entrypoint · enter · boot · env** — each
generic, each configured + named per project. Any consumer (refarm = `farm`, agents-lab = `lab`, a POC = its
own name) gets the whole Docker-Desktop / any-bring-up workflow **for free**, declaring only its env, its
lanes, and its name. Today's generic entrypoint + `on-start` split is the first member; `enter`/env are the
next, and `toolbox` already supplies the naming.

## Boundary

- The immediate `-x` patch (and the generic entrypoint already landed) stay; this is the direction they
  converge to.
- Product-neutral: the config declares lanes/env generically; the name is a rebrand; no consumer specifics.

## Flagged by

vault-seed (2026-07-02), after a hand-coded `[ -x ]` guard silently skipped a safety check — a reminder that
in refarm the fix belongs in the config/primitive layer, not the shell.
