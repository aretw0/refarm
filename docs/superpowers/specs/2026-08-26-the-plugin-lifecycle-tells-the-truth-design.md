# The plugin lifecycle tells the truth

**Date:** 2026-08-26
**Lane:** [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — the node as daily driver
**Serves:** ISS-068, ISS-167, ISS-168, and the operator's requirement stated 2026-08-26:
a healthy development cycle, an official node installing plugins correctly, and experimenting
without footguns or collisions of intent.
**Decomposed from:** a second track (non-WASM execution) gets its own spec — see *What this
spec is not* at the end.

## What forced this

The operator named four collisions and ranked them, "not knowing what is running" first:

1. not knowing what is running
2. two things claiming the same name
3. dev and production mixing
4. an intention of mine the node does not apply

Measured on his live node over 2026-08-25/26, they are not four problems. They are one
substrate answering questions it cannot answer, and three consequences.

## Measure first

Every number below was taken from the running node or the tree, not from a ticket. Three
durable records were found wrong in the same period, so nothing here is inherited.

### The host serves one fact under four names

`packages/tractor/src/sidecar/mod.rs`, `get_plugins`:

    let loaded: Vec<String> = state.plugin_channels.read().keys().cloned().collect();
    Json(json!({
        "installed": loaded,      // the same variable
        "loaded":    loaded,      // the same variable
        "known":     loaded,      // the same variable
        "local":     [],          // a literal
    }))

So **"installed but not loaded" is inexpressible**: a tree that was handed to the host and
failed to load vanishes from the answer entirely, and the silence is indistinguishable from
never having been asked for. `local` is never anything.

### And the host structurally cannot answer three of them

The daemon receives explicit paths and does not scan:

    tractor --plugin ~/.refarm/plugins/refarm_agent/plugin.wasm \
            --plugin ~/.refarm/plugins/refarm_lsp-code-ops/plugin.wasm \
            --refarm-dir ~/.refarm

The launcher decides what to load. The host knows what it was HANDED (`plugin_paths`,
`lib.rs:791`) and what LOADED (`plugin_channels`) — two facts it holds and reports as one.

### Four installed trees, one listed

    ~/.refarm/plugins/@refarm/agent/        2026-08-05  wasm 476441  integrity sha256-000000… MISMATCH
    ~/.refarm/plugins/refarm_agent/         2026-08-17  wasm 482050  integrity matches
    ~/.refarm/plugins/refarm_lsp-code-ops/  2026-07-21              integrity matches
    ~/.refarm/plugins/@refarm/pi-agent/     2026-07-22              integrity matches

`refarm plugin list` reports ONE, under every `--origin` filter. `refarm plugin status`
reports the two that loaded. Between the two commands, an installed-but-unloaded tree is
invisible. No security hole: `verify_wasm_integrity` runs at load and the daemon's own
command line settles which tree it runs.

### The install ships what it did not build, and labels it with the commit

    20:32:53  edit apps/refarm/src/commands/plugin-capability.ts
    20:37:53  commit 57ff5cc1                                  (checkout CLEAN)
    20:38:01  refarm node install -> "installed", 0.1.0-57ff5cc1
    20:13:35  apps/refarm/dist/index.js   <- NINETEEN MINUTES OLDER THAN THE SOURCE
    20:41:04  build
    20:41:xx  refarm node install -> "installed", 0.1.0-57ff5cc1   <- SAME LABEL, different code

ISS-158 closed the DIRTY case. This checkout was clean and `dist/` is gitignored: the check
guarding the label's honesty measures GIT cleanliness, and what goes stale is an artifact git
cannot see.

**And the detection already exists.** `ProjectAuditor` (`packages/health/src/auditors/project.js`)
compares the newest mtime under `src/` against `dist/` per package over
`DEFAULT_WORKSPACE_ROOTS = ["packages", "apps"]` — `apps/refarm` IS in scope and would have
reported it. Live on 2026-08-26 it names six stale packages with `staleBySeconds`. The
installer does not ask.

**The plugin installer already has the honest shape.** `plugin install` reads the wasm bytes,
computes `sha256`, and compares against the installed manifest (`installedBundleIsCurrent`).
Content-addressing exists in this repo, one command over from the one that lacks it.

### The development affordance exists and nothing declares it

`verify_wasm_integrity` (`env_and_runtime.rs:865`):

    let Some(declared) = declared else { return Ok(()); };

A manifest with NO integrity loads, documented as "backward-compatible: an un-signed local
plugin still loads". A manifest with a WRONG integrity is a hard failure. So the two states an
operator most needs to tell apart — *deliberately unsigned because I am developing it* and
*the claim is missing for some other reason* — are indistinguishable from every surface,
because the first is expressed by SILENCE.

### The scaffold produces something nothing runs

`refarm plugin new` (ADR-086) writes `ext.json` + `index.js` under `.refarm/extensions/<name>/`.
`listExtensions` reads it, `plugin list` lists it. No loader consumes it: the host has zero
occurrences of `workerEntry` or `executionContext`, `plugin install` cannot install that shape,
and both live plugins are WASM components. A developer following the documented onboarding
produces an artifact the node cannot execute, and finds out late.

### Three id spellings are live

    plugin:tem       runtime = plugin:tem     fsToken = plugin_tem
    @refarm/agent    runtime = agent          fsToken = refarm_agent
    lsp-code-ops     runtime = lsp-code-ops   fsToken = lsp-code-ops

`plugin:tem` crosses every projection unreduced, because the runtime projection splits on `/`.

## The invariant this design rests on

> **A surface may only answer a question it can observe.** Where it cannot, it says so —
> and absence declares itself rather than being read as consent.

Both halves are rules this repository has already arrived at from other directions
(ISS-131 tier 3, ISS-113, ISS-125, ISS-128). Applied here they produce the whole design.

## D1 — the install stops shipping what it did not build

**Refuse, do not warn.** Before assembling, `node install` consults the staleness check that
already covers the workspace it packages. Stale ⇒ refuse, naming the package and the lag in
seconds, with the build as `nextCommand`. **Fails closed**: mtime is a weak signal, so it can
refuse spuriously, and that is the safe direction.

**Label the content beside the commit.** A short digest of the assembled tree goes INTO THE
DIRECTORY NAME (`0.1.0-<commit>-<digest>`), with the full digest recorded in the install record.
The directory name is where it must live, because that is precisely the promise
`installVersionLabel` makes and could not keep — "two installs of 0.1.0
from different commits are different trees, and an operator rolling back has to tell them
apart in a directory listing". On 2026-08-25 two installs from the SAME commit were
indistinguishable.

**`--build` as a convenience, never the default.** Paying a build on every install is the cost
the refusal avoids.

This is a prerequisite for everything below: while the install can ship stale code, no
experiment is trustworthy, including inside the sandbox.

## D2 — four names become four facts, each answered by whoever can observe it

| state | who knows | how |
| --- | --- | --- |
| **requested** | host | the `--plugin` paths it received at startup |
| **loaded** | host | the keys of `plugin_channels` |
| **installed** | CLI | a scan of `~/.refarm/plugins/*/plugin.json` |
| **integrity** | CLI | the bytes hashed against the manifest's claim |
| **known** | declaration | `BUNDLED_PLUGIN_DESCRIPTORS` + `AGENT_CORE_BUNDLE` + config |

`known` earns its place by distinguishing *declared and not installed* — a bundled plugin this
node is supposed to carry and does not — from *never heard of*. It is reported by `plugin list`
beside `installed`, since both are the CLI's to answer. Today it is a synonym for `loaded` and
can express neither.

`get_plugins` stops synthesizing. It reports `requested` and `loaded` separately and, for a
request that never became a channel, WHY. The CLI enumerates installed trees and reports an
integrity verdict per tree, which is the same read.

**The host does NOT scan the plugins directory.** It receives paths by design — that
separation is what lets the sandbox point at a different tree, and making the host scan would
reintroduce the resolve-from-the-OS shape `docs/NO_OS_RESOLUTION.md` catalogues.

Closes ISS-167 and makes "installed but not loaded" expressible for the first time.

## D3 — "under development" is a declaration, not an absence

**The state is declared, and no declaration means refusal.** A plugin runs unverified only when
THE NODE'S CONFIG says it is under development — beside `trusted_plugins` and
`modelAuthorization`, which are the operator's other standing statements about this machine.
Without that, a manifest lacking `integrity` stops loading.

**NOT in the manifest, and this is the load-bearing half.** A manifest travels with the plugin,
so an author who marked their own plugin "under development" would ship an artifact that loads
unverified on every node that installs it — a supply-chain hole wearing a convenience's clothes.
The declaration is a statement by the operator ABOUT THIS NODE, and it is keyed by the runtime
id, the vocabulary the host already looks trust and approvals up under (proven 2026-08-25,
`57ff5cc1`). This INVERTS the default to closed and is a contract change with a real blast radius:
any unsigned plugin that exists today stops loading until declared. It is the operator's call
and it is recorded here as one.

**The state is visible wherever the plugin is.** `plugin status`, `plugin list`, `refarm health`,
and the load log. The failure mode of a development state is becoming the normal one quietly,
and `local: []` is this repository's own evidence that a field nobody populates is a field
nobody notices.

**It ages out loud.** A plugin under development for weeks is a fact, reported the way
`staleBuilds` and the ledger's own freshness gate report theirs. It does not expire by itself:
removing executable code is the operator's decision (AGENTS.md §8).

**`plugin new` produces the WASM skeleton that runs today**, and SAYS that the light track is
designed-and-not-built, pointing at its own spec. No dead end, and no promise of what does not
exist.

## D4 — the guards, designed against the way this repository actually gets it wrong

Three fixtures were found pinning defects as correct in a single day (2026-08-25:
`ask.test.ts`'s quota handoff, `plugin-approval.test.ts`'s whole vocabulary, and
`project-block-consistency`'s per-file freshness). So each guard below is designed against the
FORM of the error, not only the behaviour.

**D1's guards.** A stale tree is refused, naming the package and the lag; a fresh tree installs
(the negative control, without which "always refuse" would pass); two trees from the same
commit with different content have different identities.

> The §9 trap: a guard deciding "stale" by the SAME mtime comparison the installer uses
> inherits its blind spot. So the guard constructs the situation by CONTENT — a source whose
> text is not in `dist` — and asserts the refusal. It measures the property (shipped ≠ source),
> never the proxy.

**D2's guards.** A request that fails appears as requested-and-not-loaded WITH a reason; an
installed-but-unloaded tree appears in the listing; a hash mismatch is reported without
breaking the listing.

> The §9 trap, and it is literal here: a test asserting `installed.length === loaded.length`
> PASSES TODAY — they are the same variable. A guard that only ever sees them equal is
> indistinguishable from the current defect. Each guard constructs a state where they MUST
> differ and asserts that they do.

**D3's guards.** A manifest without integrity and without a declaration is refused; a declared
plugin loads and is marked; the state's age is reported.

> The "marked on every surface" guard enumerates the surfaces FROM THE CODE, the way
> `probe-coverage.test.ts` walks the Commander tree and accounts for all 187 leaves. A
> hand-written list silently misses a surface added later.

**Cross-cutting.** Every declared descriptor survives all three projections consistently, with
the list derived from the descriptors themselves (the pattern already used in `fc75c0c2`), so a
descriptor added later is covered without editing a test.

**Live verification, not only units.** Three of 2026-08-25's findings came from installing and
looking rather than reading: the human budget table still printing a ULID after the JSON was
fixed, `plugin status` changing shape unpredicted, and the stale `dist`. Each section closes
with a check on the real node after install — and D1 is what makes that check trustworthy,
which is the argument for the whole order.

**Stated as a limitation rather than a missing test:** the sandbox node inherits credentials BY
COPY (`docs/SANDBOX_NODE.md`), so it proves cost isolation and does not prove permission policy.

## What is NOT proposed

- **No host-side directory scan.** See D2.
- **No automatic removal of anything executable.** ISS-167's stale tree is reported, never
  pruned; the pre-convergence layout is deliberate and named in code
  (`legacyScopedPluginWasmPath`).
- **No new store.** Every fact above already exists somewhere; what is missing is a reading
  across them, and in three cases a consumer for a producer that already runs.
- **No second execution track.** See below.

## What this spec is not

The operator's requirement, 2026-08-26, in his words: *"os desenvolvedores de plugin só usariam
wasm se precisassem, o que puder extender/plugar sem wasm deveria ser permitido também"*, naming
deepseek-harness and pi.dev as prior art. That is a second execution track and it gets its own
spec, for three reasons:

1. **It is a new security surface.** JS has none of the WASM guest's isolation, and every
   permission mechanism the host applies today (`scope_to_approved`, the trust allowlist) was
   designed against a WASM guest.
2. **Its inputs already exist and deserve reading, not guessing.** `packages/plugin-tem`'s
   manifest declares a complete model — `entry`/`workerEntry`, `executionContext` with
   worker / main-thread / service-worker, `targets: [browser, server]` — and
   `packages/plugin-manifest` declares `ExecutionContextConfig`. Neither has a runtime.
3. **Order.** A light track built on a lifecycle that lies is the worst of both: it multiplies
   the confusion this spec exists to remove.

The premise is accepted and is right: a platform that requires a Rust toolchain for a theme
plugin repels exactly the authors it wants.

## The order this implies

1. **D1**, because nothing below can be verified until the install stops lying.
2. **D2**, because the operator ranked "not knowing what is running" first and it is the
   substrate the other three collisions sit on.
3. **D3**, which needs D2's `local` to be a real field before it has anywhere to live.
4. The light track, in its own spec.
