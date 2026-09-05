# A Workspace Is Not a Node

Date: 2026-08-06
Status: proposed
Related: ADR-094 (node context and workspace hatch), 2026-08-05 which-sovereign-state-is-active design,
2026-08-03 declared-node-base design, `docs/DECLARE_ONCE_INVARIANT.md`

## Why this exists

The operator stated it directly on 2026-08-06: *"um workspace não é nó"*. What follows is the
architecture that makes that true, and the measurements that show it currently is not.

### What was measured, not argued

On 2026-08-06, on node `sede`:

```
~/.refarm/config.json          workspaces: { rcdc5 }
<repo>/.refarm/config.json     workspaces: { refarm → ".", rcdc5 }
```

The refarm repository — a workspace — declared **itself** and **a second, unrelated workspace**. The
node's own catalog knew about one of them. And because `loadDeclaredWorkspaces` calls `loadConfig`
with an EXPLICIT root of `declaredBase()`, there is no walk-up: the catalog is
`<base>/.refarm/config.json` exactly. With `SOVEREIGN_BASE` undeclared that base is the current
directory, so:

| Run from | Catalog the CLI saw |
| --- | --- |
| `~/github/refarm` | `refarm`, `rcdc5` — the repo's, not the node's |
| `~/git/rcdc5` | **empty** |
| `/tmp` | **empty** |
| with `SOVEREIGN_BASE=$HOME` | `rcdc5`, `refarm` |

The workspace catalog existed only when the operator happened to be standing in a directory that had
a `.refarm/`. Inside his own rcdc5 workspace it was empty, which silently defeated the workspace
attribution shipped earlier the same week: the cwd seed resolved against an empty catalog and
attributed nothing, and the cause was not the attribution code but a base nobody had declared.

The node's base was fixed on 2026-08-06 (`scripts/tractor-start.sh` now derives `SOVEREIGN_BASE` from
`REFARM_HOME`). This spec addresses what that fix exposed rather than caused.

### The single cause behind both symptoms

`refarm workspace add --local` already exists and writes *"this workspace's local
`.refarm/config.json` instead of operator home"*. So the distinction of PLACE is built. What is not
built is a distinction of SHAPE: both places write the same thing, a `workspaces` map.

A workspace therefore has exactly one grammar available for describing itself, and that grammar is
"a catalog of workspaces". Declaring itself — and, once you have a catalog, declaring others — is not
a mistake somebody made. It is the only sentence the tool offers.

That is the two-roles-in-one-field shape this repository has been repairing all week, appearing in
configuration rather than in a type: *who I administer* and *what I offer* were collapsed into one
field, so neither could be stated without the other.

## The model

| | Node catalog | Workspace self-declaration |
| --- | --- | --- |
| Lives in | `~/.refarm/config.json` (the sovereign dir) | `refarm.workspace.json` (repository root, tracked) |
| Declares which workspaces exist and where | **yes — only here** | **never** |
| May declare commands | yes | yes |
| Nature | **authority** | **offer** |

### The filename is decided: `refarm.workspace.json`, not `config.json`, not `.refarm/`

One name for two roles was the defect this spec exists to end — `~/.refarm/config.json` and
`<repo>/.refarm/config.json` shared a filename (`config.json`) and, worse, a *shape* (a `workspaces`
map), which is what let the refarm repository declare itself and rcdc5 in the first place. The
workspace's own declaration therefore needed a name that could not be confused with the node's.

The first attempt was `<workspace>/.refarm/workspace.json`, and it was wrong on two independent axes,
both caught before Task 1 shipped:

1. **It could never arrive by `git pull`.** `.refarm/` is wholesale-gitignored (`.gitignore`: "Test
   byproducts and Local Identity"). A declaration placed there would never travel with the repository
   — a fresh clone would carry no offer, and the file would be one `git clean -fdx` from gone. That
   directly breaks R2's own premise below: R2 depends on the offer arriving by `git pull` so a node can
   review it before it takes effect. An offer that cannot arrive that way isn't an offer, it's local
   scratch state that happens to look like one.
2. **It re-entangles what this spec separates.** `.refarm/` is where a NODE's own state lives —
   identity, plugins, tls, sessions, cache. Putting a workspace's declaration inside the node-state
   directory reintroduces exactly the two-roles-in-one-place collapse the spec exists to end, just one
   level down: instead of one *file* meaning two things, one *directory* would.

The settled answer is `refarm.workspace.json` at the workspace's repository root: tracked, visible the
way `package.json` is (not hidden), and sharing no name or directory with either `config.json`. This is
implemented in `workspaceOfferPath` (`apps/refarm/src/commands/workspace-declaration.ts`), which
documents both axes at the point where a future edit would otherwise reintroduce them.

Three rules follow, and each answers a question the operator raised.

### R1. The node may declare commands without the workspace's help

A workspace that has done no refarm work at all is still fully administrable: the node declares its
path and its commands directly. This is not a degraded path, it is a first-class one.

**The living example is `rcdc5`**, and it stays that way deliberately at the operator's instruction:
its `code-boundaries` command remains declared in the node's catalog, and nothing is written into the
rcdc5 repository. It is a work repository; putting refarm configuration inside it is a commitment he
has not chosen to make, and the model must not require it.

### R2. A workspace's declaration is an offer, not an instruction

A repository that uses refarm may prepare commands for a node that might one day administer it. In
the operator's words, it *"adianta o trabalho para um possível nó que o administre"*.

Preparing is not authorising. A workspace's declaration becomes visible to a node that administers it
and does **not** become live on its own.

The reason is not hierarchy, it is provenance: a workspace's declaration arrives by `git pull`. If it
could take effect unreviewed, a repository update would silently change what the operator's machine
executes. `refarm workspace add` already calls itself a *"reviewed, authorised proposal"*; this
extends the same posture from workspaces to their commands.

### R3. On conflict the node wins, and says that it won

If a workspace offers a command whose name the node already declares, the node's definition is used —
and the divergence is reported rather than resolved in silence. Silent precedence is how an operator
ends up reading one declaration while a different one runs.

## Grammar

```
node catalog       workspaces: { id → { path, kind, repository?, commands? } }
workspace decl     { commands?, execution? }          — no `workspaces` map exists in this shape
effective          node ∪ (accepted offers), node winning any name collision
```

A `path` in the node catalog is **absolute**. A `"."` only means something relative to a base that
moves, which is the defect this spec exists to end.

## What changes on this machine

1. `~/.refarm/config.json` keeps `refarm` and `rcdc5` as catalog entries. The five VPN commands
   copied into `refarm` on 2026-08-06 are removed — they are the workspace's offer, not the node's
   declaration.
2. `<repo>/.refarm/config.json` loses its `workspaces` map entirely. It stops declaring itself and
   stops declaring rcdc5. What remains is node state that was never part of the abolished shape:
   `trusted_plugins`, `approvedPermissions`, `connections`, `spawnEnv`, and `surfaces`. The five VPN
   commands live in `<repo>/refarm.workspace.json` at the repository root — the refarm workspace's own
   offer, brought into the node's catalog only via `refarm workspace sync refarm`.
3. **`rcdc5` is not migrated.** Its command stays in the node catalog, by the operator's decision, as
   R1's living example.
4. **`--local` now refuses rather than redirects.** `workspace add --local` and `workspace command
   add/remove/remote --local` used to write into `<repo>/.refarm/config.json`'s `workspaces` map —
   exactly the shape this spec abolishes. Task 3's migration deletes that map; leaving `--local`
   pointed at it would have let one flag silently re-create the measured defect (a workspace declaring
   itself and others, readable only from the directory you happen to stand in). Redirecting `--local`
   to write `refarm.workspace.json` instead was considered and rejected: `--local` named a *place*
   (write to the workspace's own tree instead of the operator's home), and the new grammar draws the
   line on *shape*, not place — a workspace's declaration is never something a command on the node
   writes on its behalf, it is something the workspace repository states about itself and a node
   later chooses to accept via `workspace sync <id>`. The flag's original meaning — "same catalog
   shape, different location" — has no referent left in the new model, so it refuses rather than being
   quietly repointed at a different file. Every call site now throws before touching env, fs, or the
   operator channel, via one shared message
   (`localWorkspaceDeclarationAbolishedMessage`, `apps/refarm/src/commands/catalog-authoring.ts`):

   > "--local used to write this into the workspace's OWN .refarm/config.json, in the node catalog's
   > "workspaces" map shape. That shape is abolished: a workspace never declares itself or another
   > workspace, in any file — only a node does, in its own catalog. A workspace instead states what it
   > OFFERS in <workspace>/refarm.workspace.json, at the repository root ("commands", "execution"), and
   > a node brings that offer into ITS OWN catalog with `refarm workspace sync <id>`. Run `<command>`
   > from the node, without --local."

Consequence worth naming, and it is an **unblock, not a completion**: once `<repo>/.refarm/` stops
being a catalog, it stops colliding with a node rooted there. That is precisely the directory the
isolated launcher (D3 of the which-sovereign-state-is-active design) needs — the collision that made a
node-rooted-at-the-repo sandbox unsafe is gone. Nothing here builds that launcher; this spec only
removes the reason it was blocked.

## Verification

- The catalog resolves identically from any directory, because it is read from the node's declared
  base rather than the current one. Proven by running `refarm workspace list --json` from the
  repository, from `~/git/rcdc5`, and from `/tmp`, and getting the same answer.
- A workspace declaration containing a `workspaces` map is **rejected with a message naming the
  correct grammar**, not silently ignored — otherwise the old shape lingers and is believed.
- An offer is not live until accepted; a test drives an unaccepted offer and asserts the command does
  not resolve.
- A name collision resolves to the node's definition AND produces a reported divergence.
- `rcdc5` continues to work end to end with no file written into its repository.

### Measured on the node, 2026-08-06 (Task 4)

Full raw output in `.superpowers/sdd/2026-08-06-a-workspace-is-not-a-node/task-4-report.md`.

With `SOVEREIGN_BASE="$HOME"` exported, `refarm workspace list --json` from `~/github/refarm`,
`~/git/rcdc5`, and `/tmp` all returned the identical `['rcdc5', 'refarm']` — the claim above, proven.

Without `SOVEREIGN_BASE` exported, the same three directories also agreed with each other — but on
`[]`, not on the node's real catalog. This is **not** the pre-fix baseline recorded earlier in this
document (`refarm`/`rcdc5` from the repo, empty from the other two): that asymmetry existed only while
`<repo>/.refarm/config.json` still carried a `workspaces` map. Once that map was removed (`What changes
on this machine`, item 2), the repository directory lost its accidental answer along with it.
`declaredBase()`'s cwd fallback is unchanged; what changed is that the file it falls back to reading no
longer has anything to answer with. See the CLI-base non-goal below — this is that gap, measured after
the fix rather than before it.

A `workspaces` map written into a scratch offer (never the real `refarm.workspace.json`) was refused
with `workspace-sync-offer-invalid`, naming the key found (`"workspaces"`), where it belongs
(`~/.refarm/config.json`, the node's catalog), and the command that puts it there (`refarm workspace
add`) — full message in the Task 4 report.

`rcdc5`'s catalog entry resolved both `code-boundaries` and `vpn` with `SOVEREIGN_BASE="$HOME"` set,
and `~/git/rcdc5/rcdc5/.refarm` does not exist.

## Non-goals

- **No migration of rcdc5.** Stated above, and it is the operator's call rather than an oversight —
  R1's living example: `code-boundaries` and `vpn` stay declared in the node catalog, nothing is
  written into the rcdc5 repository, deliberately.
- **The CLI's own base is not changed here.** An operator shell without `SOVEREIGN_BASE` still
  resolves from the current directory (`declaredBase()`'s positional fallback), so the CLI and the node
  can still disagree. Measured 2026-08-06 (Task 4):

  | Run from | With `SOVEREIGN_BASE=$HOME` | Without `SOVEREIGN_BASE` |
  | --- | --- | --- |
  | `~/github/refarm` | `rcdc5`, `refarm` | *(empty)* |
  | `~/git/rcdc5` | `rcdc5`, `refarm` | *(empty)* |
  | `/tmp` | `rcdc5`, `refarm` | *(empty)* |

  The three directories now agree with each other even without the variable — but they agree on
  nothing, because `<repo>/.refarm/config.json` no longer carries a `workspaces` map for the repo
  directory to fall back to. Before this spec's changes, the repo directory answered `refarm`,
  `rcdc5` while the other two answered empty: an asymmetric wrong answer. After: a symmetric empty
  one. Neither is the node's real catalog. Whether to close that gap by exporting the variable (making
  the operator's shell agree with the node explicitly) or by changing `declaredBase`'s fallback from
  positional to stable (making the CLI agree with the node even when unset) is the operator's decision;
  reporting the disagreement belongs to the cockpit work.
- **No workspace hatch.** ADR-094's richer binding (`homeMode`, `credentialMode`,
  `runtimeNamespaceMode`) is not built here.
- **No sandbox launcher.** This spec removes the collision that blocks it; building it is separate.
