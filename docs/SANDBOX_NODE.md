# The Sandbox Node

A second, isolated `refarm` node, out of this working tree — for developing and testing `refarm`
itself without a test dispatch landing in the operator's real `BudgetObservation` ledger. Not
hypothetical: on 2026-08-05, 8 of 29 observations in the operator's real record were test dispatches
from a prior line of work, because there was nowhere else for them to go.

Built by `docs/superpowers/plans/2026-08-06-the-sandbox-node.md` and delivered as D3/D4 of
`docs/superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md`. This document is the
durable operational record — start here; go to `scripts/refarm-sandbox.mjs`'s own header comment
for exhaustive implementation detail on any point below.

**Everything below was verified against a running sandbox on 2026-08-07**, not written from memory.

---

## Quick start

```bash
# From the repo root.
node scripts/refarm-sandbox.mjs start --background
node scripts/refarm-sandbox.mjs status --json
node scripts/refarm-sandbox.mjs --reset            # deletes <repo>/.sandbox and nothing else
```

There is no `stop` subcommand yet (see "What is NOT isolated" below). To end a `--background` run:
confirm the pid is really the sandbox's own, then kill it.

```bash
node scripts/refarm-sandbox.mjs status --json | jq '.node.pid'
kill <that pid>
```

`status --json` classifies the node into exactly one of three states — `running`, `not-running`,
`unknown` — and never guesses: a stale pid file after a crash or reboot resolves cleanly to
`not-running`, the ordinary case, not an error.

Real output, captured live:

```
$ node scripts/refarm-sandbox.mjs start --background
   Sandbox node
   pid       : 3385966
   ws port   : 43000
   http port : 43001
   namespace : sandbox
   refarm-dir: <repo>/.sandbox/refarm
   graph dir : <repo>/.sandbox/share
   plugin    : <repo>/.sandbox/refarm/plugins/refarm_agent/plugin.wasm
   log       : <repo>/.sandbox/tractor-sandbox.log
   pid file  : <repo>/.sandbox/tractor-sandbox.pid

$ node scripts/refarm-sandbox.mjs status --json
{
  "sandboxRoot": "<repo>/.sandbox",
  "exists": true,
  "refarmHome": { "path": "<repo>/.sandbox/refarm", "exists": true },
  "graphDir": { "path": "<repo>/.sandbox/share", "exists": true },
  "logFile": { "path": "<repo>/.sandbox/tractor-sandbox.log", "exists": true },
  "credential": { "path": "<repo>/.sandbox/silo/identity.json", "exists": true, "mode": "600" },
  "pidFile": "<repo>/.sandbox/tractor-sandbox.pid",
  "node": { "pid": 3385966, "state": "running", "detail": "pid 3385966 confirmed as this sandbox's tractor process (--refarm-dir matches)" }
}
```

`status` never reads `.sandbox/silo/identity.json`'s *contents* — only `existsSync`/`statSync` touch
it, so it can report presence and octal mode but is structurally incapable of leaking a credential
value.

`--reset` refuses unless the sandbox's node reads `not-running`; `--force` overrides only that
refusal (never the `running` case — an operator with a live node has a real remedy already: stop
it), and is read only after five independent containment checks already ran (path containment,
three explicitly named forbidden real paths — `~/.refarm`, `~/.silo`, `~/.local/share/refarm` — a
symlink refusal at the sandbox root, and a recursive symlink refusal inside the tree).

---

## The seven axes

The plan's own opening claim — "one pair of declarations relocates everything" — was wrong four
times over. A launcher that relocates only the sovereign pair "isolates" a node that still opens the
operator's real graph. Seven declarations, every `start`, none optional:

| Axis | Value (this repo) | Purpose | Follows `REFARM_HOME`? |
| --- | --- | --- | --- |
| `SOVEREIGN_BASE` | `<repo>/.sandbox` | the node's base directory | — it IS this |
| `SOVEREIGN_DIR` | `refarm` | the sovereign dir name | — it IS this |
| `REFARM_HOME` | `<repo>/.sandbox/refarm` | declarations, plugins, streams, task-results | — it IS this |
| `XDG_DATA_HOME` | `<repo>/.sandbox/share` | **the graph** (`packages/tractor/src/storage/sqlite.rs:433-438`) | **NO** — a sibling of `REFARM_HOME`, never nested under it |
| `SILO_HOME` | `<repo>/.sandbox/silo` | credential store — deliberately NON-isolating, see below | NO — a sibling |
| `HOME` | `<repo>/.sandbox/home` | redirects every `os.homedir()` call in the child process | NO — a sibling |
| `REFARM_STREAMS_DIR` | `<repo>/.sandbox/refarm/streams` | where the WASM guest writes response stream content | nested under `REFARM_HOME` |

Each row exists because a prior row's declaration was found *insufficient*, in this order:

1. **`SOVEREIGN_BASE`/`SOVEREIGN_DIR`/`REFARM_HOME`** — the starting pair, one axis (`REFARM_HOME`
   is the same directory `SOVEREIGN_BASE + SOVEREIGN_DIR` resolves to; declaring it keeps the
   TypeScript stack and the Rust host agreeing about the sandbox exactly as they already agree about
   the operator's own node).
2. **`XDG_DATA_HOME`** — measured directly: the operator's live graph is
   `~/.refarm/data/refarm/default.db` (`tractor-start.sh` pins `XDG_DATA_HOME` under `REFARM_HOME`
   for the operator's node too), while `~/.local/share/refarm/default.db` is a stale 49KB leftover.
   A sandbox missing this axis would have opened the stale file and proved nothing was isolated.
3. **`SILO_HOME`** — without it, `resolveSiloHome()`'s fallback chain (`SILO_HOME` → `REFARM_HOME` →
   `~/.silo`) silently resolved against the sandbox's own, now-declared, empty `REFARM_HOME` —
   `refarm model current --json` degraded all the way to the keyless `ollama/llama3.2` floor with
   no error. A plausible-looking wrong answer, not a crash.
4. **`HOME`** — `refarm plugin install`'s asset store
   (`packages/storage-fs/src/scope.ts:60-63`, `options.userHome ?? homedir()`) ignores the declared
   home unconditionally. Confirmed on disk:
   `~/.refarm/assets/6d78b1c152ecba006f53bf2a07fa4544faef98f23144f8153a0baa8235ae3eca` (the working
   tree's `agent.wasm`, 478129 bytes) was written into the **operator's real home** by the sandbox's
   own install, before this axis existed. Content-addressed and try/caught, so it never corrupted
   the operator's running node — but it was a real write into `~/.refarm/assets/` that no axis was
   supposed to allow.
5. **`REFARM_STREAMS_DIR`** — declaring `HOME` does *not* reach the WASM guest: the host's own
   security design never forwards `HOME` into the plugin
   (`packages/tractor/src/host/plugin_host/env_and_runtime.rs:52-58`,
   `packages/tractor/src/host/plugin_host/core.rs:270`). The guest reads `$HOME` directly
   (`packages/agent/src/runtime/prompt_handler.rs:47`, `#[cfg(target_arch = "wasm32")]`), and with
   neither `REFARM_STREAMS_DIR` nor an effective `HOME` in its own curated env, its fallback landed
   on a hardcoded `/tmp/streams/` — the agent's *response content*, outside `.sandbox/`, not cleaned
   by `--reset`. Verified live, not just traced: one real dispatch landed its ndjson at
   `.sandbox/refarm/streams/…ndjson`; `/tmp/streams/` was never created; the operator's
   `~/.refarm/streams/activity.ndjson` was untouched (same size/mtime before and after).

**Ports**: 43000 (WS) / 43001 (HTTP) — checked against every live listener on the host at plan time
(`ss -ltn`) and declared as constants, not re-probed each run, so the address stays stable across
restarts. The operator's node uses 42000/42001.

**Namespace**: `sandbox`, versus the operator's `default`. This is what makes the graph filename
itself differ (`sandbox.db` vs `default.db`), independent of the `XDG_DATA_HOME` directory split.

The canonical, importable recipe for all of the above is `sandboxEnvironment(repoRoot)` in
`scripts/refarm-sandbox.mjs` — any script that needs to talk to the sandbox should import it, never
re-derive the paths by hand. Verified live in the course of writing this document:

```bash
node -e '
import("./scripts/refarm-sandbox.mjs").then(m => {
  const env = m.sandboxEnvironment(process.cwd());
  for (const [k, v] of Object.entries(env.env)) console.log(`export ${k}=${JSON.stringify(v)}`);
  console.log(`export REFARM_NAMESPACE=${JSON.stringify(env.namespace)}`);
  console.log(`export REFARM_SIDECAR_URL=${JSON.stringify("http://127.0.0.1:" + env.httpPort)}`);
});
'
```
prints exactly the seven `export KEY=value` lines above, plus `REFARM_NAMESPACE` and
`REFARM_SIDECAR_URL` (returned separately by `sandboxEnvironment`, not folded into its `env` object).

---

## Credentials: inherited by copy, never by reference

The durable source, `~/.silo/identity.json`, is **read-only** from the sandbox's point of view —
nothing in `scripts/refarm-sandbox.mjs` ever calls a write API against a path built from it.
`copySandboxCredentials` copies the **minimum set** a fresh scan of every real consumer
(`packages/config/src/model-routing.js`, `apps/refarm/src/commands/model.ts`, the Rust host's
`ModelRoute::for_provider`) actually reads, into an independent file:

```
.sandbox/silo/identity.json   (mode 600, dir mode 700)
{
  "tokens": {
    "modelProvider", "modelId", "oauthProvider",
    "model" (legacy alias), "modelBaseUrl", "modelFallbackProvider", "modelFallbackModelId",
    "oauthCredentials": { "<active provider>": { "access", "accountId", "expires" } }
  }
}
```

**Deliberately excluded**, and why "minimum" is not just "convenient":

- **`oauthCredentials.*.refresh`** — a repo-wide grep for `.refreshToken(` found zero call sites
  anywhere that invoke `OAuthProviderInterface#refreshToken`. Not even the operator's own daemon
  auto-refreshes today. A refresh token is strictly more powerful than the access token it would sit
  beside, for a capability nothing exercises — copying it would be the opposite of "minimum."
- **`githubToken`, `githubOwner`, `cloudflareToken`** — unrelated integrations, not read by the
  model-routing consumer this copy exists to serve.
- **Any other (dormant) provider's `oauthCredentials` entry** — only the ACTIVE
  `tokens.oauthProvider`'s entry is ever read.
- **The top-level `identity` block** (device identity, `masterPublicKey`) — not part of `.tokens` at
  all; `SiloCore#loadTokens()` never surfaces it.

The env-var half (`OPENAI_CODEX_ACCESS_TOKEN`, `MODEL_PROVIDER`, `MODEL_ID`, …) is **derived**, not
copied twice: `startSandbox` shells out to the already-compiled
`refarm model env --shell --include-secrets` — the exact command the operator's own
`scripts/tractor-start.sh` uses — scoped to the sandbox's `SILO_HOME`, reusing the one existing
implementation of "which vars, from which Silo fields" instead of re-deriving it.

---

## The plugin: installed, not loaded directly

`startSandbox` runs `refarm plugin install --bundled` with the sandbox's **own** declared
environment (never bare `process.env` — this was verified live with a throwaway `REFARM_HOME`
before ever running it against the real sandbox) before starting the daemon. This installs into
`<repo>/.sandbox/refarm/plugins/refarm_agent/` and the daemon loads *that*, never the raw
`packages/agent/dist/agent.wasm` build output directly — which lacks the `entry`/`integrity` fields
only `refarm plugin install`'s `installPlugin()` writes, and which the daemon refuses at boot
(`missing field 'entry'`). This exact failure took down the first cost-proof attempt (see below).

"The lab runs what you are building" is kept regardless: the installer's own source resolution still
reads the working tree's `packages/agent/dist/agent.wasm` — hash-verified identical to the installed
copy on every proof run. A rebuild is picked up on the next `start` (the installer compares content
hash, not just a version file, so it re-installs even at the same package version).

Confirm the plugin is actually loaded with a **runtime** query, never a file check:

```bash
REFARM_SIDECAR_URL=http://127.0.0.1:43001 refarm plugin status --json
# { "plugins": [ { "id": "@refarm/agent", "installed": true, "loaded": true, "local": false } ] }
```

---

## The cost proof

The measurement this whole slice exists to produce (`.superpowers/sdd/2026-08-06-the-sandbox-node/task-4-report.md`):

```
operator BudgetObservation: 29 → 29
sandbox  BudgetObservation:  0 → 1
```

One `refarm ask "reply with just: ok" --new --json` dispatched against the sandbox, exit 0, `gpt-5.5`
via `openai-codex`, 1590 input / 5 output tokens, `pricing_mode: "subscription"`. The new
`BudgetObservation` carried `refarm.pricing_mode: "subscription"`, `refarm.cost.estimated_usd: 0.0`,
`refarm.cost.price_known: true`, `refarm.budget.spawner: "refarm-ask"`. The operator's record,
independently re-checked before and after, did not move on any axis checked (pid, cmdline, plugin
hash, `~/.silo/identity.json` hash, `default.db` size/mtime, observation count).

**This proof did not survive on disk** — the sandbox's graph was recreated when `HOME` became the
sixth declared axis, and the observation above is gone from the live database. That is exactly why
the rest of this section exists: the numbers are real and were independently witnessed, but a record
that stays only in a session transcript did not survive. What follows is a runnable procedure to
re-derive the same shape of proof from scratch, at any time.

### Reproduction procedure

**Step 0 — the sandbox must be running.**

```bash
node scripts/refarm-sandbox.mjs status --json
# if .node.state !== "running":
node scripts/refarm-sandbox.mjs start --background
```

**Step 1 — derive the sandbox's declared environment** (never hand-type it — see "The seven axes"
above for why):

```bash
node -e '
import("./scripts/refarm-sandbox.mjs").then(m => {
  const env = m.sandboxEnvironment(process.cwd());
  for (const [k, v] of Object.entries(env.env)) console.log(`export ${k}=${JSON.stringify(v)}`);
  console.log(`export REFARM_NAMESPACE=${JSON.stringify(env.namespace)}`);
  console.log(`export REFARM_SIDECAR_URL=${JSON.stringify("http://127.0.0.1:" + env.httpPort)}`);
});
' > /tmp/sandbox.env
source /tmp/sandbox.env
```

**Step 2 — count both graphs, read-only, BEFORE.** The graph stores every typed entity in one
`nodes` table (columns: `id`, `type`, `context`, `payload`, `source_plugin`, `updated_at`) keyed by
`type`, not one table per type — confirmed against both databases' own schema while writing this
document.

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const os = require('node:os');
const path = require('node:path');
const sandboxDb  = '.sandbox/share/refarm/sandbox.db';
const operatorDb = path.join(os.homedir(), '.refarm/data/refarm/default.db');
for (const [label, p] of [['sandbox', sandboxDb], ['operator', operatorDb]]) {
  const db = new DatabaseSync('file:' + p + '?mode=ro', { readOnly: true });
  const { c } = db.prepare(\"SELECT COUNT(*) AS c FROM nodes WHERE type='BudgetObservation'\").get();
  console.log(label, p, c);
  db.close();
}
"
```

Expected shape: two lines, `sandbox <path> <N>` and `operator <path> <M>`. The absolute counts vary
run to run (both graphs accumulate observations from ordinary use); what the next steps must prove
is the **delta**, not any particular starting number.

**Step 3 — dispatch exactly ONE ask against the sandbox**, bounded, no retry:

```bash
timeout 90 refarm ask "reply with just: ok" --new --json
```

Expected shape (values will differ — this is the envelope, not a byte-for-byte target):

```json
{
  "effortId": "<uuid>",
  "sessionId": "urn:sovereign:session:v1:<hex>",
  "content": "ok",
  "metadata": {
    "model": "<model id>",
    "provider": "<provider id>",
    "tokens_in": <int>,
    "tokens_out": <int>,
    "pricing_mode": "subscription" | "usage",
    "estimated_usd": <number>
  },
  "ok": true
}
```

**If this fails with `agent-not-loaded`**: the plugin is not loaded — re-check
`refarm plugin status --json` against the sandbox's sidecar (Step above, "The plugin") before
retrying. Do not retry blindly; a failed pre-check spends no quota, but repeated dispatches without
diagnosing the cause risk one that does reach a provider.

**Step 4 — count both graphs again, same read-only queries.** Expected: the sandbox's count
increased by exactly 1; the operator's count is unchanged (`+0`).

**Step 5 (optional) — read the new observation's fields**, to confirm the record's shape and the
known attribution gap:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('file:.sandbox/share/refarm/sandbox.db?mode=ro', { readOnly: true });
const row = db.prepare(\"SELECT payload FROM nodes WHERE type='BudgetObservation' ORDER BY updated_at DESC, id DESC LIMIT 1\").get();
console.log(JSON.parse(row.payload));
"
```

Expect `refarm.pricing_mode`, `refarm.cost.estimated_usd`, `refarm.cost.price_known`,
`refarm.budget.spawner` present, and (as of this writing) `refarm.workspace.id` and `host.name`
**absent** — the sandbox graph has no `SovereignConfig` node, so those two attribution fields are
never populated (a config gap, not a `BudgetObservation` bug; `host.id` still uniquely identifies
the sandbox node). `ORDER BY updated_at DESC, id DESC` matches this repo's own documented ordering
contract — see `docs/SOVEREIGN_RECORD_ORDERING.md`.

---

## What is NOT isolated

Anything shared between the two nodes is a fact someone will trip over — named here rather than
left to be discovered:

- **`SILO_HOME` isolates the credential STORE, not the credential.** The identity is inherited by
  copy on purpose — an isolation that forced re-authentication would not get used. The sandbox and
  the operator's node share the same underlying access token today; revoking or rotating one affects
  both.
- **The `openai-codex` token expires, and nothing in this repo auto-refreshes it — on either node.**
  A repo-wide grep for `.refreshToken(` call sites found none. The sandbox's copy goes stale exactly
  when the operator's own does; re-running `refarm sow` followed by a fresh `start` (which re-syncs
  the copy on every start) is the recovery. This is not a sandbox-specific gap.
- **There is no `stop` subcommand.** `--reset` has a documented, unclosed TOCTOU race with `start`:
  `resetSandbox`'s own liveness read and its delete call are not protected by any lock, so a `start
  --background` and a `--reset` racing in two terminals could observe `not-running` a moment before
  the former's pid file exists. Recorded in `resetSandbox`'s own JSDoc as accepted, not closed, in
  this slice.
- **The engine mode is not one of the isolating axes, and it drifted anyway.** The operator's
  `~/.refarm/config.json` pins `tractor.engine: "rust"`; the sandbox has no `config.json` at all and
  falls back to the documented default `"auto"`. Found live by `refarm parity`'s very first run; not
  fixed by this slice (the parity command is the instrument, not the fix).
- **`refarm context` reports a spurious `namespace-divergence` for the sandbox.** `--namespace
  sandbox` reaches the daemon as a bare CLI argument, never a `REFARM_NAMESPACE` env var, so the
  environ-based witness (`resolveNodeEnvironment`, which reads only `/proc/<pid>/environ`) reports
  the node "declares no `REFARM_NAMESPACE`" and describes it as `"default"`. The database file the
  daemon actually opens (`sandbox.db`, never `default.db`) settles the real namespace independent of
  that report.
- **The working directory both nodes' processes were started from is the same repository.** Nothing
  about the sandbox isolates *code* — both nodes execute the same working-tree source; only state
  (graph, credentials store, sovereign dir, home) is split. Measured 2026-08-19, this is not only a
  sandbox limit: the operator's REAL node runs the same working tree, through a shim in
  `~/.local/bin`, and its backup does not carry it. See [`NODE_SUBSTRATE.md`](NODE_SUBSTRATE.md).

---

## Known loose ends (not yet fixed)

Each names its own evidence rather than asking a future reader to rediscover it:

- **`packages/storage-fs/src/scope.ts:60-63`** — `options.userHome ?? homedir()` ignores the
  declared home for **every** consumer of `scopedAssetsDir`, not just the sandbox's plugin install.
  Same shape as the `declaredBase` defect already fixed elsewhere in this repo: a resolver asking
  the OS instead of reading the declaration. `apps/refarm/src/utils/composition-resolver.ts` has the
  identical defect in its `"user"` tier (currently unreachable from this launcher and the daemon,
  confirmed by review, but not fixed).
- **The sandbox's `BudgetObservation` lacks `refarm.workspace.id` and `host.name`** because the
  sandbox graph has no `SovereignConfig` node. A lab that isolates cost but records an
  unattributable observation solves only half of the cost-separation problem.
- **`apps/refarm/src/commands/runtime-stop.ts`** has the same `parseInt` leniency bug the sandbox's
  own `parseSandboxPidFile` was fixed to avoid: `Number.parseInt("123abc", 10)` returns `123`
  (finite, positive) rather than being refused, so a truncated/corrupted pid file could be silently
  accepted as a plausible pid. `scripts/refarm-sandbox.mjs`'s own fix (`/^[0-9]+$/` before the
  `parseInt`) is the pattern to port.
- **`scripts/no-os-resolution.mjs`** (baseline **119** sites, `docs/NO_OS_RESOLUTION.md`) is the
  ratchet that would catch the `scope.ts` defect above by construction going forward. Its own
  burn-down plan (`docs/superpowers/plans/2026-08-07-no-resolver-defaults-to-the-os.md`) has Task 1
  done and Task 2+ (the actual burn-down) not started. Task 1 modified `.github/workflows/test.yml`,
  a CLAUDE.md §8 protected surface — the operator has been told and has not yet ruled on it.

## See also

- `docs/superpowers/plans/2026-08-06-the-sandbox-node.md` — the plan this doc records the delivery
  of, with the full per-task ledger.
- `docs/superpowers/specs/2026-08-05-which-sovereign-state-is-active-design.md` — the design (D1
  `refarm context`, D2 divergence detection, D3 this launcher, D4 `refarm parity`).
- `docs/SOVEREIGN_RECORD_ORDERING.md` — why the graph query above orders by `updated_at DESC, id
  DESC`, and what breaks if a reader takes the front of an unordered result instead.
- `docs/NO_OS_RESOLUTION.md` — the ratchet against the resolver shape this document's loose ends
  both instantiate.
- `scripts/refarm-sandbox.mjs` — the implementation; its own header comment is the authoritative,
  line-cited source for every mechanism summarized above.
- `apps/refarm/src/commands/parity.ts` — `refarm parity`, D4's implementation.
