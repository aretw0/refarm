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
| Lives in | `~/.refarm/config.json` (the sovereign dir) | `<workspace>/refarm.workspace.json` (repository root, tracked — corrected in Task 3's fix round 1; `.refarm/` is node state and is gitignored, so a declaration placed there could never arrive by `git pull`) |
| Declares which workspaces exist and where | **yes — only here** | **never** |
| May declare commands | yes | yes |
| Nature | **authority** | **offer** |

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
   stops declaring rcdc5. What remains is the refarm workspace's own offer: those same five commands.
3. **`rcdc5` is not migrated.** Its command stays in the node catalog, by the operator's decision, as
   R1's living example.

Consequence worth naming: once `<repo>/.refarm/` stops being a catalog, it stops colliding with a
node rooted there. That is precisely the directory the isolated launcher (D3 of the
which-sovereign-state-is-active design) needs. Ending this confusion and enabling that sandbox are
one movement, not two.

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

## Non-goals

- **No migration of rcdc5.** Stated above, and it is the operator's call rather than an oversight.
- **The CLI's own base is not changed here.** An operator shell without `SOVEREIGN_BASE` still
  resolves from the current directory, so the CLI and the node can still disagree. Whether to close
  that by exporting the variable or by changing `declaredBase`'s fallback from positional to stable
  is the operator's decision; reporting the disagreement belongs to the cockpit work.
- **No workspace hatch.** ADR-094's richer binding (`homeMode`, `credentialMode`,
  `runtimeNamespaceMode`) is not built here.
- **No sandbox launcher.** This spec removes the collision that blocks it; building it is separate.
