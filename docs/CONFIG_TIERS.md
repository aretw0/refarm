# Config tiers: who owns which key

`.refarm/config.json` is read at more than one place on the filesystem. Until
2026-08-10 nothing declared **which key belongs to which place** — so every key
was, in effect, workspace-declarable, including the ones that decide what a
plugin may do to the machine.

That is not untidiness. It is a privilege boundary.

## The two tiers

| Tier | Where | What it is |
| --- | --- | --- |
| `node` | `<declaredBase()>/.refarm/config.json` — normally `~/.refarm/config.json` | This device's own answer. Replicates cross-device as `urn:sovereign:config:workspace` (the URN's name is a misnomer this document does not fix). |
| `workspace` | `<repo>/.refarm/config.json` | A repository's answer, anchored where the operator stands. `packages/storage-fs/src/scope.ts` calls this the `workspace` ledger scope. |

`storage-fs` also declares an `org` scope. It has no filesystem default and
throws unless an `orgRoot` is passed, so no key is owned by it today.

> **Known divergence** — `storage-fs`'s `user` scope and `declaredBase()` are two
> rules for the same directory: the first is `os.homedir()`, the second follows
> `SOVEREIGN_BASE` / `REFARM_HOME`. Under a declared home they disagree. Tracked
> as ISS-102; this table is written in terms of the `node` tier, which is
> `declaredBase()`.

## The rule: a workspace states a need, it never holds a grant

The operator's ruling, 2026-08-10:

> *"o workspace só declara e a nossa estrutura possa ser configurada, o workspace
> pode só indicar para que o nó saiba o que configurar se for aprovado"*

So a node-owned key never carries a value in the workspace tier. A workspace
names what it needs under `requests`, and the node's onboarding turns a request
into a grant **if the operator approves**:

```jsonc
// <repo>/.refarm/config.json — a workspace ASKS
{
  "health": { "ignoredGitVisibilityPatterns": ["dist"] },   // owned here: keep
  "requests": {
    "approvedPermissions": { "@refarm/lsp-code-ops": ["fs:read"] }
  }
}
```

```jsonc
// ~/.refarm/config.json — the node GRANTS
{
  "approvedPermissions": { "@refarm/lsp-code-ops": ["fs:read"] }
}
```

The word was already in the schema. `approvedPermissions` is a grant, and a
grant has a grantor.

`requests` is inert by construction: nothing composes it into effective config,
so a request cannot become a grant by accident. `pendingRequests(workspace, node)`
is the onboarding queue — every requestable key a workspace asked for that the
node has not answered. A key the node has already answered is **not** pending,
whatever the answer was: granting and refusing are both decisions, and re-asking
a decided question is how an operator learns to approve without reading.

## The sanction: dropped and reported, never a load failure

A key outside its tier is removed from the composition and reported. The node
keeps starting.

Fail **open for availability, closed for privilege**. An operator whose daily
driver refuses to boot over a stray key fixes it by deleting the guard.

## The table

`packages/config/src/config-tiers.js` — `CONFIG_KEY_OWNERSHIP`. One line per
key, correctable in one line, each carrying a reason a reader can re-check.

| Key | Owner | Requestable | Why |
| --- | --- | --- | --- |
| `approvedPermissions` | node | yes | the grant itself, enforced by the Rust host |
| `spawnEnv` | node | yes | what the host injects into every spawned process — a repo setting it chooses which binaries run |
| `trusted_plugins` | node | yes | which plugin code may load; a plugin cannot be trusted to decide this about itself |
| `nodeTools` | node | yes | auditing a declared tool RUNS it, so whoever holds this key chooses which binaries the node executes — see [`docs/node-tools.md`](node-tools.md) |
| `connections` | node | yes | names a command that runs on THIS machine |
| `delivery` | node | yes | channels carry the node's credentials |
| `processes` | node | yes | a long-running process on the node |
| `node` | node | no | the node's own identity |
| `tractor` | node | no | which runtime engine this device runs |
| `surfaces` | node | no | how the node exposes itself and which gate guards it |
| `workspaces` | node | no | a workspace declaring the catalog containing it is circular |
| `health` | workspace | no | audit policy about this repository's own tree |

A key **not in the table** is `unknown` — neither allowed nor forbidden. It is
kept (so the table's incompleteness never costs a working node) and reported (so
a capability key added next quarter is not workspace-declarable on the day it
ships).

## Measured against the real configs, 2026-08-10

```
~/.refarm/config.json          tier node       10 keys kept, 0 dropped
<this repo>/.refarm/config.json  tier workspace   0 keys kept, 5 dropped
    high    trusted_plugins, approvedPermissions, connections, spawnEnv
    warning surfaces
```

Every key in this repository's workspace-tier config is node-owned. Four of the
five are capability keys, and two of those (`approvedPermissions`, `spawnEnv`)
are enforced by the Rust host.

## Why this is not yet wired into the composition

`auditConfigTier` is pure and currently used for reporting only. Wiring it into
the readers **changes what those configs do** — by the measurement above, this
repository's workspace config would go from five keys to zero. That is a
deliberate act with a blast radius, and it belongs to its own slice, not to the
commit that wrote the contract.

**One key does not wait for that slice.** `nodeTools` is enforced at its own
reader (`readNodeToolDeclaration` in `apps/refarm/src/commands/health.ts`),
because auditing a declared tool spawns it: a repository that could hold this key
would choose which binaries the machine runs, and cloning it would be enough. A
workspace config that declares `nodeTools` is **not honoured and IS reported** —
the sanction this document already describes, applied early because the reader
that creates the risk is the one that can close it. Every other key still follows
the reporting-only rule above.

## The Rust half — fixed 2026-08-11

`packages/tractor/src/host/plugin_host/config_node.rs`'s `declared_base()` used
to be two branches: `SOVEREIGN_BASE`, or `current_dir()`. It now runs the same
five-step chain as its TypeScript twin:

| Step | Source | `DeclaredBaseOrigin` |
| --- | --- | --- |
| 1 | `SOVEREIGN_BASE` | `SovereignBase` |
| 2 | `dirname(REFARM_HOME)` | `RefarmHome` |
| 3 | `HOME`, then `USERPROFILE` | `EnvHome` |
| 4 | the OS home (`dirs::home_dir()`) | `OsHome` |
| 5 | the current directory | `Cwd` |

Step 5 is kept — an embedded or test use still wants an answer — but it is
NAMED, so a caller can tell a node that knows where it lives from one reporting
whichever directory someone last stood in.

**How exposed was this?** Less than an earlier draft of this document claimed,
and the correction matters. `main.rs:441` sets `SOVEREIGN_BASE` from
`--refarm-dir` (default: a `dirs`-based home) **before any declaration is read**,
so the daemon binary never reached the fallback. The exposure was to consumers of
this crate that are not that binary. The earlier text said `SOVEREIGN_BASE` is
set by neither `refarm runtime start` nor the operator's profile — true, and
incomplete, because the daemon sets it itself.

**The parity bug was the real one.** `Path::parent()` and `path.dirname()`
disagree on exactly the cases ISS-028 names — `.refarm` → `Some("")` vs `"."`,
and `/` → `None` vs `"/"` — so a relative `REFARM_HOME` an operator can really
type resolved to two different directories in the two stacks. `dirname_like_ts`
fixes that and is pinned by its own test.

**What the fix exposed.** Ten Rust tests failed the moment step 3 landed: 92
connection tests became 85. They were passing *through* the defect — three
copies of a `CwdGuard` entered a temp fixture directory and let the cwd fallback
carry the base. With a real chain they read the operator's actual
`~/.refarm/config.json` instead. The three copies are now one
`DeclaredBaseGuard` in `test_support` that DECLARES the base and still enters the
directory. Their intent was always "the node's base is this temp dir"; `cd` was
the only way to say it while `cd` was the only thing the resolver read.
