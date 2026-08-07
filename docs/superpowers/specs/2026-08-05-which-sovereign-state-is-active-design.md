# Which Sovereign State Is Active

Date: 2026-08-05
Status: delivered — D1 (`refarm context`), D2 (divergence detection, all three clauses), D3 (the
isolated launcher), and D4 (`refarm parity`) all shipped; see each section below for its own
"Delivered" note and commit range.
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
  **Built 2026-08-06 — see the section immediately below. This bullet is left standing, unedited,
  as the record of the decision; it is no longer the current state of the code.**

**Delivered 2026-08-06, as `docs/superpowers/plans/2026-08-06-two-halves-one-node.md`: the
positional fallback above is gone, and `SOVEREIGN_BASE_KEY`'s own doc comment — "read identically
by the Rust host and this stack, so the two cannot answer from different directories on the same
node" — is true for the first time.**

The measurement that showed it was not: with `SOVEREIGN_BASE`/`REFARM_HOME` both unset,
`declaredBase()` (`packages/config/src/index.js`) resolved `process.cwd()` while
`dirs_sovereign_base` in `packages/tractor/src/main.rs:760-776` never reads cwd at all (it resolves
`REFARM_HOME`, else the OS home) — the exact asymmetry the doc comment already claimed did not
exist. `refarm workspace list --json`, the plan's own worked example, returned the repository's own
(wrong) catalog when run from the repository and an **empty** catalog from `~/git/rcdc5` and
`/tmp`, purely because of which directory the CLI process happened to be started from.

Delivered as:

- **`declaredBase(env = process.env)`** now mirrors `dirs_sovereign_base` step for step:
  `SOVEREIGN_BASE` (trimmed) wins outright; else `dirname(REFARM_HOME)` (a container declaring
  `REFARM_HOME=/srv/node/.refarm` resolves `/srv/node`, matching the Rust host reading the same
  variable); else `os.homedir()`. `process.cwd()` is never read, at any step. Its `cwd` parameter
  is **removed, not defaulted** — the fallback signature stayed `declaredBase(env, cwd =
  process.cwd())` in early drafts of this line of work, and a default is exactly as load-bearing as
  a fallback: any caller that did not pass `env` explicitly, or that relied on the old default,
  would keep resolving cwd silently. Removing the parameter makes every call site that needs the
  operator's actual directory say so at the call site, in code a reviewer can see, rather than in a
  default a reviewer has to already know to distrust. Commit `56738ec1`.
- **The call-site audit that made this safe.** Before changing the signature, every real
  `declaredBase(...)` invocation in the repo was traced to what it feeds (twelve production call
  sites across four files, per `.superpowers/sdd/2026-08-06-two-halves-one-node/task-1-report.md`).
  Ten wanted the node's base cleanly (catalog reads — `workspace.ts`'s `list`/`status`/`mounts`/
  `sources`/`materialize`/`refresh` actions, `context.ts`'s own comparison, `ask.ts`'s
  `declaredWorkspaceRoots`). Nine of the ten already called `declaredBase()` with zero explicit
  arguments and needed no code change beyond the signature itself; the tenth, `context.ts:463`,
  passed `cwd` as an explicit second positional argument and needed only that argument dropped —
  the single compile error the signature change produced across the whole repo
  (`context.ts(463,30): error TS2554: Expected 0-1 arguments, but got 2`), per `task-3-report.md`.
  **Two sites genuinely wanted the current project's directory** and were given an explicit
  `process.cwd()` fallback rather than being collapsed onto the node's base:
  - `doctor.ts:370`'s `operatorBase` (`resolveScopeComparison`), which exists specifically to be
    compared against the node's home so `scope-doctor` can report when they disagree. Collapsing it
    onto `declaredBase()` would have made both sides of that comparison identical by construction
    and silently disabled the divergence this doctor finding exists to report — the audit's own
    words: "the clearest, least-ambiguous 'wanted the project's directory' site."
  - `workspace.ts`'s `resolveWorkspaceExecutionCwd` (defined at line 388; the flagless branch is at
    line 405 as of this writing), split into two branches rather than one resolution: with
    `--workspace`, it still wants the node's base (a catalog lookup by id); without it, it wants the
    directory the operator is standing in, fed to `buildWorkspaceExecutionStatus` (whose own default
    is `process.cwd()`) to inspect *this* directory's package manager/turbo/cache state. One
    `baseDir` variable had served both wants before; it could not any longer. Commit `3f93e955`.
- **`refarm context`'s `cliBaseOrigin` label, corrected to match.** The field had labelled the
  non-`SOVEREIGN_BASE` branch `"cwd"` — accurate before this change, false the moment the fallback
  stopped reading cwd. It now names three states read off the same two checks `declaredBase()`
  itself performs: `"SOVEREIGN_BASE"`, `"REFARM_HOME"`, `"home"`. Commit `805c8fed`. This changes
  `refarm context --json`'s output shape, so `refarm agent finish --lane handoffs --run --json` was
  run before it landed, per this repo's own CLAUDE.md.

Proven live (`.superpowers/sdd/2026-08-06-two-halves-one-node/task-4-report.md`), with
`SOVEREIGN_BASE`/`REFARM_HOME` both unset:

- `refarm workspace list --json` returns `['rcdc5', 'refarm']` from the repository, from
  `~/git/rcdc5`, and from `/tmp` alike. Three states this design's own history has now passed
  through, in order: the repository's own wrong catalog from the repository and empty elsewhere
  (before the workspace-is-not-a-node plan); empty everywhere (after it, before this plan); correct
  and identical everywhere (now).
- `sovereign:base-divergence` is gone from both `refarm context` and `refarm doctor --json`:
  `cli base: /home/s095407044 (from home)` now matches `node base: /home/s095407044`.
- **The check can still fail, and that is what distinguishes "fixed" from "no longer able to
  notice."** `SOVEREIGN_BASE=/tmp/deliberately-wrong refarm context` still reports
  `base-divergence`, naming both sides: *"The node's base is /home/s095407044 (the node was told
  SOVEREIGN_BASE=/home/s095407044), but this CLI resolves base to /tmp/deliberately-wrong (from
  SOVEREIGN_BASE) — they disagree."* `sovereign:base-divergence` reappears in `refarm doctor --json`
  under the same override. A divergence report that could no longer fire would be indistinguishable
  from a comparison that had been quietly deleted; this is the test that rules that out.
- `scope-doctor`'s comparison (the one call site above that deliberately kept `process.cwd()`) still
  differs between directories, as designed: `scope:auth-policy-divergence` and
  `scope:config-divergence` fire from the repository checkout (which carries its own stray
  `.refarm/config.json` and `.refarm/auth-policy.json`) and do not fire from `~/git/rcdc5` (which
  has no `.refarm` directory at all). Its survival through this plan is the negative control —
  proof that "the two halves agree" was scoped to the base *resolver*, not applied by reflex to
  every comparison that happens to involve a directory.

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

**Delivered 2026-08-06/07, as `docs/superpowers/plans/2026-08-06-the-sandbox-node.md`** (16 commits,
`ecc128f6..a39af0d0`; `scripts/refarm-sandbox.mjs` + `scripts/refarm-sandbox.test.mjs`, 161/161
tests).

The paragraph above — "declares `SOVEREIGN_BASE` and `SOVEREIGN_DIR`" — undercounted by five. The
plan's own ledger records the correction as its first entry, before Task 1 even started: **seven**
declared axes, not one pair, each closing a distinct measured failure —

| Axis | Purpose | Follows `REFARM_HOME`? |
| --- | --- | --- |
| `SOVEREIGN_BASE` | the node's base directory | — it IS this |
| `SOVEREIGN_DIR` | the sovereign dir name (`refarm`) | — it IS this |
| `REFARM_HOME` | declarations, plugins, streams, task-results | — it IS this |
| `XDG_DATA_HOME` | **the graph** (`storage/sqlite.rs:433-438`) | NO — a sibling, `<repo>/.sandbox/share` |
| `SILO_HOME` | credential store — deliberately NON-isolating, see below | NO — a sibling, `<repo>/.sandbox/silo` |
| `HOME` | added after `refarm plugin install` wrote the working-tree wasm into the operator's real `~/.refarm/assets/` (`packages/storage-fs/src/scope.ts:60-63` ignoring the declared home) | NO — a sibling, `<repo>/.sandbox/home` |
| `REFARM_STREAMS_DIR` | added after the WASM guest (`packages/agent/src/runtime/prompt_handler.rs:47`, wasm32-only) was found writing response content to `/tmp/streams/`, because the host never forwards `HOME` into the plugin | nested under `REFARM_HOME`: `<REFARM_HOME>/streams` |

Ports **43000** (WS) / **43001** (HTTP) — checked against every live listener on the host at plan
time (`ss -ltn`) and declared as constants, not re-probed on every run, so the address stays stable
across restarts — versus the operator's 42000/42001. Namespace `sandbox`, versus the operator's
`default`.

Subcommands: `start [--background] [--json]`, `status [--json]`, `--reset [--force]`. There is **no
`stop` subcommand** — the only way to end a `--background` run today is `kill <pid>` after confirming
the pid's own `/proc/<pid>/cmdline` names this sandbox (`--refarm-dir` matching this sandbox's
`REFARM_HOME`, never the operator's). `--reset` deletes `<repo>/.sandbox` and nothing else, behind
five independent containment checks (path containment, three explicitly named forbidden real paths,
a symlink refusal at the root and recursively inside the tree); it refuses unless the sandbox's own
liveness check reads `"not-running"` — a whitelist, not a blacklist of the then-two known unsafe
states — with `--force` overriding only that refusal, read after all five containment checks and
never able to override `"running"` itself.

**Credentials are inherited by COPY, never by reference or re-authentication.**
`copySandboxCredentials` reads `~/.silo/identity.json` read-only and writes an independent file at
`.sandbox/silo/identity.json` (mode 600, dir mode 700), carrying only the minimum set
`minimalCredentialTokens` extracts: `modelProvider`, `modelId`, `oauthProvider`, the legacy `model`
alias, `modelBaseUrl`, `modelFallbackProvider`, `modelFallbackModelId`, and the ACTIVE oauth
provider's `{access, accountId, expires}` only. Deliberately excluded: the `refresh` token (no call
site anywhere in the repo invokes `OAuthProviderInterface#refreshToken` — not even the operator's
own node auto-refreshes today, so copying it would hand the sandbox a strictly more powerful
credential for a capability nothing exercises), `githubToken`/`githubOwner`/`cloudflareToken`
(unrelated integrations), any dormant non-active provider's credentials, and the `identity` block
(device identity — not part of `.tokens` at all). `SILO_HOME` is declared alongside the seven axes
but is deliberately **not** one of them: it points `resolveSiloHome()`'s fallback chain at the copy
instead of letting it silently resolve against the sandbox's own empty `REFARM_HOME` — measured
before the fix, that silent fallback degraded to the keyless `ollama/llama3.2` floor with no error
at all.

**The plugin is installed, not loaded directly.** `startSandbox` runs `refarm plugin install
--bundled` with the sandbox's own declared environment (never bare `process.env` — verified with a
throwaway `REFARM_HOME` before ever touching the real one) before starting the daemon, installing
into `<repo>/.sandbox/refarm/plugins/refarm_agent/` and loading what the installer wrote — never the
raw `packages/agent/dist/agent.wasm` build output directly, which lacks the `entry`/`integrity`
fields only the installer adds and which the daemon refuses to load at boot (`missing field
'entry'` — Task 4's first-attempt failure, fixed by commit `8e7c88a2`). "The lab runs what you are
building" is kept: the installer's own source resolution still reads the working tree's
`packages/agent/dist/agent.wasm`, hash-verified identical to the installed copy on every proof run.

#### The cost proof

The measurement this whole slice exists to produce, from
`.superpowers/sdd/2026-08-06-the-sandbox-node/task-4-report.md` (a re-run after the plugin-install
fix — the first attempt failed at an `agent-not-loaded` pre-check before any provider call and
proved nothing):

```
operator BudgetObservation: 29 → 29
sandbox  BudgetObservation:  0 → 1
```

One `refarm ask "reply with just: ok" --new --json` dispatched against the sandbox
(`REFARM_SIDECAR_URL=http://127.0.0.1:43001`), exit 0, `gpt-5.5` via `openai-codex`, 1590 input / 5
output tokens, `pricing_mode: "subscription"`. The sandbox's new `BudgetObservation` carried
`refarm.pricing_mode: "subscription"`, `refarm.cost.estimated_usd: 0.0`,
`refarm.cost.price_known: true`, `refarm.budget.spawner: "refarm-ask"` — `price_known: true` beside
`estimated_usd: 0.0` together mean "priced in the wrong currency" (a subscription has no per-call
dollar cost), not missing data. The operator's own record, independently re-checked before and
after, did not move: pid 3093335 unchanged, cmdline unchanged, plugin hash unchanged,
`~/.silo/identity.json` unchanged (content never read), `default.db` size/mtime unchanged.

**This proof did not survive on disk.** The sandbox's graph was recreated when `HOME` became the
sixth declared axis (a fresh `.sandbox` tree after a `--reset`), and by 2026-08-07 09:40 the sandbox
held exactly one `BudgetObservation`, timestamped 09:33:45 — from a later verification dispatch, not
this one. The numbers above are real and were independently witnessed at the time, but nothing on
disk attests to them now. The full, runnable reproduction procedure — start the sandbox, count both
graphs read-only, dispatch one ask, count again, with the exact read-only SQL — is recorded durably
in [`docs/SANDBOX_NODE.md`](../../SANDBOX_NODE.md) rather than left as a session memory a second
time.

#### What is NOT isolated

- **`SILO_HOME` isolates the credential STORE, not the credential.** The identity is inherited by
  copy on purpose — an isolation that forced re-authentication would not get used (the design's own
  stated principle, taken from `pi-isolated.mjs`). The sandbox and the operator's node share the
  same underlying access token today.
- **The `openai-codex` token expires, and nothing in the repo auto-refreshes it — on either node.**
  The sandbox's copy goes stale exactly when the operator's own does; re-running `refarm sow`
  followed by a fresh `start` (which re-syncs the copy every time) is the recovery.
- **There is no `stop` subcommand.** `--reset` has a documented, unclosed TOCTOU race with `start`:
  its own liveness read and its delete call are not protected by any lock, so a `start --background`
  and a `--reset` racing in two terminals could observe `"not-running"` a moment before the former's
  pid file exists. Recorded in `resetSandbox`'s own JSDoc as accepted, not closed, in this slice.
- **The engine mode is not one of the isolating axes, and it drifted anyway** — caught live by
  `refarm parity`: the operator's `~/.refarm/config.json` pins `tractor.engine: "rust"`; the sandbox
  has no `config.json` at all and falls back to `"auto"`. Not fixed by this slice (D4 is the
  instrument, not the fix).

### D4. Parity

`refarm parity` compares the sandbox against the operator's node on declared axes — configured
providers and routes, installed plugins and their hashes, engine and namespace — and reports where
they differ. Divergence is normal in a lab; **undeclared** divergence is what makes a lab lie.

**Delivered 2026-08-06/07** as `refarm parity` (`apps/refarm/src/commands/parity.ts` +
`parity.test.ts`, 55/55 tests, part of the same 16-commit range above, landing across `ccba05eb`,
`5fb83cb6`, `a39af0d0`).

Four axes, exactly the ones named above, each compared against the RUNNING node, never a file check:
`model-route` (provider/model ref plus credential state), `plugin` (queried live from each node's
own `GET /plugins` sidecar — loaded state AND file hash), `engine`, `namespace`. One static table,
`ISOLATING_AXES`, is the single place "namespace is allowed — expected — to differ" is declared;
every comparison crosses that fact against the observed verdict (`same | different | unreadable`) to
produce `healthy`, so a namespace that stopped differing (isolation silently broken) is reported
**unhealthy** rather than accepted because "same" sounds fine — the inverse check, pinned by its own
test.

Three verdict states everywhere, `unreadable` checked first: stopping the sandbox mid-run flips only
the `plugin` axis to `unreadable` (the one live network probe) while the other three stay
determinate (file/declared-based) — proven live, not just designed, by stopping the sandbox and
confirming the report degrades exactly one axis, never silently reading a dead node as matching or
as diverging.

Explicitly out of scope, stated in the command's own header rather than left unmentioned: parity
compares CONFIGURATION, not graph CONTENT — the sandbox `BudgetObservation`'s missing
`refarm.workspace.id`/`host.name` (the sandbox graph has no `SovereignConfig` node) is a
graph-content gap, not something this axis set checks.

**One caveat found live, not yet fixed:** `refarm parity` reports a real engine-mode divergence (see
"What is NOT isolated" above) on its very first live run. Separately, `refarm context` (a related
but different command) reports a spurious `namespace-divergence` for the sandbox: `--namespace
sandbox` is passed to the daemon as a bare CLI argument, never as a `REFARM_NAMESPACE` env var, so
the environ-based witness (`resolveNodeEnvironment`, which reads only `/proc/<pid>/environ`) reports
the node "declares no `REFARM_NAMESPACE`" and falls back to describing it as `"default"`. The
on-disk artifact settles the question independent of that report: the daemon opens
`.sandbox/share/refarm/sandbox.db`, never `default.db`.

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
