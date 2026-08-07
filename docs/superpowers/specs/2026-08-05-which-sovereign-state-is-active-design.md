# Which Sovereign State Is Active

Date: 2026-08-05
Status: proposed
Implements: ADR-094 (Proposed) D1, D4, D5 — the parts that answer the operator's question
Related: 2026-08-04 node-context-workspace-hatch design, 2026-08-03 declared-node-base design,
2026-08-04 router-decides-from-the-catalog design, `docs/DECLARE_ONCE_INVARIANT.md`

## Why this exists

The decision log's entry for ADR-094 states its origin as "repeated operational mismatch where
credential setup and runtime startup observed different homes/stores, creating 'configured' versus
'not usable' outcomes for the same operator workflow."

On 2026-08-05 that mismatch cost real work. During a plan that touched the agent component, three
separate agents and the controller each formed a wrong picture of which artifact the node was
running, because nothing in the system will say.

### What was measured, not argued

| Path | SHA-256 | Modified | Loaded? |
| --- | --- | --- | --- |
| `~/.refarm/plugins/refarm_agent/plugin.wasm` | `22dbabbd…` | 2026-08-05 17:27 | **yes** — the running `--plugin` argument |
| `packages/agent/dist/agent.wasm` | `22dbabbd…` | 2026-08-05 17:31 | no, but it is what `plugin install` copies |
| `<repo>/.refarm/plugins/refarm_agent/plugin.wasm` | `321c6625…` | 2026-07-30 | no |
| `<repo>/.refarm/plugins/@refarm/agent/plugin.wasm` | `68af329e…` | 2026-07-21 | no |

Four locations, three distinct binaries, two of them six and fifteen days stale. `refarm doctor
--json` answered `ok: true` with zero findings at every point. Two agents independently reported
`doctor` clean while the daemon ran nine-hour-stale code, verified by hand with sha256; the
`runtime:stale` finding the project handoff records as SHIPPED did not fire.

Nothing here was a wrong belief that a careful operator could have avoided by looking harder. There
is no command to look at. `refarm context` does not exist.

## What the operator already solved elsewhere

`~/github/agents-lab/scripts/pi-isolated.mjs` isolates a development install of `pi` from the
operator's personal one. Its stated purpose: "avoid hidden drift from `~/.pi/agent` in curation/dev
sessions; keep settings/sessions/runtime artifacts scoped to this repository; preserve
reproducibility when debugging monitor/runtime behavior."

Three properties are worth taking, and one is worth taking deliberately:

1. **One variable relocates everything.** `PI_CODING_AGENT_DIR` points at `<repo>/.sandbox/pi-agent`
   instead of `~/.pi/agent`. There is no partial isolation to reason about.
2. **Credentials are inherited, not isolated.** `auth.json` is copied from the global directory into
   the local one. Isolation that forced re-authentication would not get used.
3. **Isolation ships with parity.** `pi-parity.mjs` compares what is configured against declared
   profiles, scoped `user | project | both`. Isolation without a parity check trades one silent
   drift for another.

## What Refarm already has, and what is missing

The mechanism exists. `packages/config/src/index.js:132-142` declares both selectors, and the
comment states the guarantee this work makes checkable:

> the neutral env var that names WHERE this node's declarations live … injected the same way and
> read identically by the Rust host and this stack, **so the two cannot answer from different
> directories on the same node**.

| | agents-lab (pi) | Refarm today |
| --- | --- | --- |
| Variable that relocates state | `PI_CODING_AGENT_DIR` | `SOVEREIGN_BASE` + `SOVEREIGN_DIR` ✅ |
| Isolated launcher | `pnpm pi:isolated` | missing |
| Command naming the active state | `pi:isolated:status` | missing |
| Parity checker | `pi-parity.mjs` | missing |
| Selective credential inheritance | `auth.json` copied | missing |
| Covered by a CI gate | `test:pi:isolated` | missing |

Refarm has the selectors and no cockpit. This design builds the cockpit.

## Design

Two of these four are CLI subcommands and one is a repository script, deliberately. `refarm context`
and `refarm parity` **inspect a node** and are useful on any machine running Refarm, including one
that never clones this repository — they belong to the product. The isolated launcher **builds a
development sandbox out of this working tree** and is meaningless without it, exactly as
`pi-isolated.mjs` is a script in agents-lab rather than a `pi` subcommand. Divergence detection is
not a surface of its own; it is output of the first two plus `refarm doctor`.

### D1. `refarm context` — one command, one resolved answer

ADR-094's D1 requires any command touching credentials, runtime, provider routing or node-owned
policy to resolve a single effective context, and its D4 requires a success answer to name *where*.
`refarm context` is that answer made inspectable on its own.

It reports, as JSON and as text: the mode (`node-global` or `workspace-sandbox`), the sovereign home
and how it was chosen (declared via `SOVEREIGN_BASE`, or fallen back to cwd), the runtime namespace,
the credential source, the running node's identity, port and pid, and the plugin artifact actually
loaded **with its hash**.

The hash is the part that would have prevented today. A path proves nothing; two paths can hold
different bytes, and did.

### D2. Divergence is reported, never resolved silently

ADR-094's D5: when components disagree, surface a divergence finding rather than picking one and
pretending the answer is obvious. Concretely, `refarm context` and `refarm doctor` report when the
loaded artifact's hash differs from the built artifact, when a sovereign directory exists at a path
nothing loads, and when the TypeScript stack and the Rust host would resolve different homes.

`runtime:stale` exists and did not fire. This design treats that as a defect to be diagnosed by the
implementation, not routed around: whatever replaces it must be proven to fire by deliberately
staling an artifact, not by inspection.

**The third clause — "when the TypeScript stack and the Rust host would resolve different homes" —
was undelivered when this spec was written, and is delivered as of
`docs/superpowers/plans/2026-08-06-the-node-answers-for-itself.md`.**

The measurement that opened it: `refarm context`, run as `cd ~/git/rcdc5 && refarm context`,
printed a `base:` line reading `/home/s095407044/git/rcdc5 (from cwd)` directly above the `node:
sede […]` line — positioned and phrased as though it answered for the running node. It did not:
that was `declaredBase()`'s result for THIS CLI INVOCATION (`packages/config/src/index.js:151-154`),
never the running node's. `refarm context` reported one of the two as if it settled the question.
That reproduction stands, unaltered by the correction below.

**Correction (final fix wave, 2026-08-06 — the same day, a later review of the plan this
correction is delivered as):** this section originally went on to explain the daemon's side as
`readlink /proc/<pid>/cwd` reading `/home/s095407044/github/refarm`, called that "the daemon's
actual base", and said the daemon had "fallen back to `declaredBase()`'s own cwd fallback… the
TypeScript stack and the Rust host were each resolving a home no one had declared." That
explanation was false on two counts. First, the Rust host never calls the TypeScript
`declaredBase()` — it is a different runtime; nothing in `main.rs` invokes JavaScript. Second,
and independent of that, the daemon does not resolve its base from its own cwd at all, and has
not since `f67f9273` (2026-08-02, four days before this measurement): `main.rs` settles
`SOVEREIGN_BASE` itself — `REFARM_HOME`'s parent when that env var is set (as it was here), else
the OS home directory itself (`dirs_sovereign_base`'s other branch joins `SOVEREIGN_DIR` onto the
home dir and the base is THAT join's parent — the home dir either way; never `/proc/<pid>/cwd`) —
and publishes the settled value into `~/.refarm/node.json`'s `declarationBase` before any
declaration is read. That file said `/home/s095407044/.refarm`'s parent, `/home/s095407044`,
throughout this incident — not the repository directory `readlink` happened to report; the two
were simply uncorrelated facts, not the daemon's base and its fallback. The witness that states
this directly (`declarationBase`) already existed at the time of this measurement
(`node_descriptor.rs`, commit `8e0dba23`, landed the same day as `f67f9273`) and went unread —
which is itself the subject of a further correction below (`apps/refarm/src/commands/context.ts`,
commit `48f96ac6`).

Delivered as:

- **The witness.** `apps/refarm/src/utils/node-environment.ts` (`resolveNodeEnvironment`, commit
  `3ed54a44`) reads the running node's own `/proc/<pid>/environ` and `/proc/<pid>/cwd` instead of
  reconstructing a value from the CLI process's `process.env`. A field is `null` when the node
  declares that variable nowhere — the node fell back rather than being told, itself a finding —
  and the function itself returns `null` only when the process could not be read at all; the two
  never collapse into each other.
- **`refarm context` answers for the node.** `apps/refarm/src/commands/context.ts` (commit
  `5f777ef7`) reports `base`/`namespace` from `nodeEnvironment`, not from the CLI invocation's own
  `declaredBase()`; the CLI's own values stay in the report as a second, clearly labelled fact
  (`cliBase`/`cliBaseOrigin`/`cliNamespace`). Three `DivergenceKind`s were added: `base-divergence`,
  `namespace-divergence`, and `node-environment-unknown` for a running node whose environ could not
  be read — a gap in the checking, never silently read as agreement or as a divergence.
  **Corrected same-day (final fix wave, commit `48f96ac6`): `base-divergence` now compares against
  `node.json`'s `declarationBase`, not `nodeEnvironment.base` — see the correction above this list
  for why the environ-only witness was wrong for base specifically. `nodeEnvironment` remains the
  witness for `namespace-divergence` and for whether the node's base was told or derived, folded
  into the `base-divergence` summary as a third fact rather than dropped.**
- **`refarm doctor` sees it.** `apps/refarm/src/commands/sovereign-divergence-doctor.ts` (commit
  `93f3c5e9`) surfaces `sovereign:base-divergence`, `sovereign:namespace-divergence`, and
  `sovereign:environment-unknown`. A fourth finding, `sovereign:stale-descriptor`, closes a
  cross-signal gap the 2026-08-06 plan named separately (a stale `node.json` descriptor beside a
  **reachable** runtime sidecar) that neither `node-not-running` nor `runtime:not-ready` reported on
  its own — not one of the three D2 clauses above, but folded into the same commit because it is
  the same subject (divergence reported, never resolved silently).

**Live, now: the divergence fires from both directions, not only the one this plan predicted.**
`scripts/tractor-start.sh` (commit `a37419e0`, 2026-08-06) now derives the daemon's
`SOVEREIGN_BASE` from `REFARM_HOME`, so the running node declares
`SOVEREIGN_BASE=/home/s095407044` — the parent directory of both `~/github/refarm` and
`~/git/rcdc5`. The operator's shell declares no `SOVEREIGN_BASE`, so the CLI's base is wherever it
is invoked from. `base-divergence` therefore fires running `refarm context` from **either**
checkout, not only from `~/git/rcdc5` as originally predicted — the two agree only if the operator
stands in `$HOME` itself. That is a correct report of a real, current disagreement, not a defect in
the comparison.

What remains open:

- **The platform limit.** The comparison reads the daemon's `/proc/<pid>/environ` and
  `/proc/<pid>/cwd` — a Linux `/proc` fact. On a platform without `/proc`, the witness is
  unavailable and `resolveNodeEnvironment` cannot read the process; the answer is
  `node-environment-unknown`, not a wrong comparison, but the check itself does not run there. This
  design does not claim portability beyond that.
- **`declaredBase()`'s own fallback is still positional, and this plan leaves it that way on
  purpose.** `declaredBase()` (`packages/config/src/index.js:151-154`) falls back to
  `process.cwd()` when `SOVEREIGN_BASE` is unexported — the same fallback the daemon used to take,
  and the CLI still does. Commit `a37419e0`'s own message records the choice as open ("exporting
  the variable, or changing `declaredBase`'s fallback from positional to stable — is the operator's
  decision, not a side effect of this fix"); the operator has since decided the direction — change
  the CLI's fallback to a stable value (e.g. `$HOME`) rather than a positional one, on the grounds
  that the 2026-08-03 field failure this line of work traces to was about inferring scope from
  *where a process stands*, and `$HOME` is not positional in that sense. That change is **not**
  built by this plan; it is recorded here so it is not re-litigated as new information later.

### D3. The isolated launcher

`pnpm refarm:isolated` declares `SOVEREIGN_BASE` and `SOVEREIGN_DIR` at `<repo>/.sandbox/refarm`,
inherits credentials from the operator's home the way `pi-isolated` inherits `auth.json`, and starts
a node on its own port and namespace.

Its own graph store comes with it, which is the property the operator asked for and which pi does not
need: **an experiment's cost lands in the sandbox's `BudgetObservation` record, not in the operator's
real ledger.** This is not hypothetical — the live proofs for the workspace-attribution plan on
2026-08-05 wrote test dispatches into the operator's real cost record, and there was no other place
for them to go.

`status` and `--reset` follow `pi-isolated`'s surface. `--reset` deletes the sandbox and nothing else.

### D4. Parity

`refarm parity` compares the sandbox against the operator's node on declared axes — configured
providers and routes, installed plugins and their hashes, engine and namespace — and reports where
they differ. Divergence is normal in a lab; **undeclared** divergence is what makes a lab lie.

## The intake principle, which governs beyond this slice

Recorded here because it was settled while designing this and has no other home yet.

Refarm's grain is that data reaches the agent **at runtime, by injection or from the graph, without
reading disk**. The router design already states this as its D1: the catalog "reaches the guest by
injection, not by embedding", travelling the `MODEL_*` seam the host already screens, exactly as
`MODEL_CONFIGURED_PROVIDERS` does.

That does **not** mean files are unsupported. A user who keeps local files and has assimilated
nothing into the graph is a user Refarm should serve, and compatibility with pi's on-disk structure
is worth having. The resolution is a boundary, not a prohibition:

> **The runtime contract is the truth; a file is one producer of it.** Nothing downstream knows
> whether a declaration arrived from a file, from the graph, or by injection.

This is `DECLARE_ONCE_INVARIANT` mirrored. That invariant says one declaration projects to every
output surface; this says every input source converges on one declaration. Same discipline, opposite
direction.

Two consequences worth stating now, because both are live questions elsewhere:

- The `.pi/agents/*.agent.yaml` and `.pi/monitors/**` files in this repository are residue from
  working here through pi. They stay for compatibility. **Refarm does not couple to them** — nothing
  in Refarm may require them to exist or read them as a runtime source.
- The handoff's open question "where does a node-scoped automation live?" is answered by this
  principle: the graph, with `.project/automations.json` as a project-scoped producer rather than the
  home of node-scoped state.

## Verification

- `refarm context --json` names the loaded artifact's hash, and a test proves the reported hash
  matches the file the running process was started with.
- Divergence detection is proven by **deliberately staling an artifact** and asserting the finding
  fires. Inspection is not proof; `runtime:stale` passed inspection and did not fire.
- The isolated launcher is proven by starting a sandbox node, dispatching one ask, and asserting the
  observation landed in the sandbox's record and **not** in the operator's.
- Parity is proven by declaring a divergence and asserting it is reported.
- A CI gate covers the launcher, mirroring `test:pi:isolated`.

## Non-goals

- **The workspace hatch is not built here.** ADR-094's hatch (`homeMode`, `credentialMode`,
  `runtimeNamespaceMode`) is a richer binding than this slice needs. `refarm context` reports
  `mode: node-global | workspace-sandbox`; the hatch adds modes later without changing the command.
- **No agent-knowledge intake is built here.** The intake principle above is recorded, not
  implemented. Making curated declarations reach the agent at runtime is separate work.
- **The router is not built here.** It is separately designed and awaits its own plan.
- **`refarm dispatch` and the workspace attribution ladder are untouched.**
