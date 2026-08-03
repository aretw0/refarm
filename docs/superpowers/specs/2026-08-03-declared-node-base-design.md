# The node's declarations come from what it was told, not from where it was started

Date: 2026-08-03
Status: Design — not implemented. Touches `packages/tractor/**` (CLAUDE.md §8 protected surface),
so it needs the maintainer's approval before code.
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — interfaces, devices and nodes

## What forced this

The operator started a declared operation from their phone and got a failure that named nothing
useful:

```
✗ workspace:rcdc5:code-boundaries: falhou (exit 1)
   ✗ a operação prometeu operation-result.v1, mas não entregou um envelope válido
```

The workspace command was declared, the script worked, and the fail-closed spawn environment
reproduced it correctly by hand. What differed was that the runtime had been restarted from a
terminal sitting in `~/github/refarm` instead of `~`. The sidecar resolves declarations from
`std::env::current_dir()`, so the spawned `refarm` read the REPOSITORY's `.refarm/config.json` —
where workspace `rcdc5` declares `vpn` and not `code-boundaries` — refused, exited 1, and emitted
no envelope.

Nothing in that chain was broken. Every part did what it was told; they were told different things.

## The finding that decides the shape

**The node already receives its base and one subsystem ignores it.** The running daemon's argv is:

```
tractor --plugin …/agent/plugin.wasm --refarm-dir /home/s095407044/.refarm
```

`main.rs:443` resolves it once — `args.refarm_dir.clone().unwrap_or_else(dirs_sovereign_base)` —
and threads it into the auth policy, Scarecrow, and the node's base dir. Declaration resolution
never asks for it. It asks the filesystem where the process happens to be standing.

This repository has spent a fortnight applying one rule across four domains: **declared, never
detected** — surfaces (D-surfaces), delivery (D1), connections, remotely-initiable operations.
`current_dir()` is detection, in the one place where being wrong is silent and remote.

## D1 — The base is a value the node carries, not a question it asks the OS

`refarm_dir` becomes an explicit input to declaration resolution, passed from `main()` the way it
already is to the auth policy. A subsystem that needs the node's declarations receives the base;
none of them calls `current_dir()` to find it.

This does not remove project scoping — it makes it declarable. A developer who wants the
repository's declarations passes `--refarm-dir <repo>/.refarm`, and gets exactly that, on purpose.
What disappears is inheriting a scope from whoever last typed `cd`.

## D2 — Not every `current_dir()` is asking the same question

The map below is why this cannot be a blanket replacement. Two of the sites legitimately mean "the
project the operator is working in" rather than "this node's declarations", and changing those
would break a real behaviour to fix a different one.

### The map — 10 production sites (6 further occurrences are test scaffolding)

**Group A — the node's own declarations. These must follow `refarm_dir` (5 sites).**

| site | what it resolves |
| :-- | :-- |
| `sidecar/remote_initiation.rs:262` | `resolve_entrypoint()` — the spawn env AND the `refarm` binary used for every remotely-initiated operation. **This is the one that failed.** |
| `host/host_effects_bridge/spawn_env.rs:168` | `spawn_env_from_config()` — resolved once at host boot and cloned into every plugin's bindings, so a wrong base is frozen into every later spawn |
| `host/host_effects_bridge/connection_host.rs:118` | `connections_catalog()` — which declared connections exist |
| `host/host_effects_bridge/surfaces_decl.rs:405` | `surfaces_from_config()` — which surfaces are open, and how far |
| `host/plugin_host/env_and_runtime.rs:1339` | `grant_base` — its own comment claims it is "the approval scoping, AND the shell-effect bindings — one source of truth" |

That last comment is worth reading twice. The file already knows this value should have ONE source;
it just picked the wrong one.

**Group B — derived from the same base, and must not drift from Group A (2 sites).**

| site | what it resolves |
| :-- | :-- |
| `host/plugin_host/env_and_runtime.rs:1400` | `plugin_env_vars_from(&base, …)` |
| `host/plugin_host/env_and_runtime.rs:1565` | `plugin_env_vars_from(&base, …)` |

**Group C — genuinely about the current project, and should stay (3 sites).**

| site | why it stays |
| :-- | :-- |
| `host/lsp_bridge.rs:409` | a language server's workspace root IS the directory being edited |
| `host/lsp_bridge.rs:761` | same |
| `host/host_effects_bridge/policy_and_fs.rs:756` | a fallback when resolving a relative path the CALLER supplied; the caller's frame of reference is the process, not the node |

## D3 — Fixing one site is worse than fixing none

Today all ten agree: they all detect. That is wrong but coherent. Changing only
`remote_initiation.rs` would make remotely-initiated operations resolve against one base while the
connections, surfaces and plugin grants of the SAME node resolve against another — a node whose
answer to "what may I do" depends on which subsystem is asked. Groups A and B move together or not
at all.

## D4 — A base that cannot be observed will be wrong again

The failure was silent because nothing reports which base the running node is using. The operator
saw `exit 1` and no hint that the node was answering from a different declaration set than the one
they were reading. Whatever else this change does, the node must be able to say where its
declarations come from — in `refarm runtime status`, and as a `refarm doctor` finding when the
operator's own scope differs from the running node's.

This is the half that turns the next occurrence from a two-hour hunt into a line of output.

## What this is not

- **Not "force the operator's home".** That would delete project scoping, which is a real and used
  composition. The point is that scope becomes declared.
- **Not a fix for `resolve_entrypoint` alone.** See D3.
- **Not a supervision change.** Declaring the runtime as a supervised process with a fixed
  `workingDirectory` — the mechanism that kept `web-serve` correct across the reboot — would anchor
  THIS node while leaving the design detecting. It is a fine thing to do, and it is not this.

## Verification the change must carry

1. A test that starts the sidecar with `--refarm-dir <A>` from cwd `<B>` and asserts every Group A
   resolver reads `<A>`, not `<B>`. This is the regression that produced the spec, and it is
   currently unwritable because the base is not an input.
2. The existing `connection_decl`, `surfaces` and `spawn_env` suites keep passing with the base
   threaded rather than detected.
3. `refarm runtime status --json` reports the declaration base, and a doctor finding fires when it
   differs from the scope the operator is asking from.

## Cost

Ten call sites, of which seven move. `packages/tractor/**` is protected under CLAUDE.md §8, so this
is one serialized slice with the maintainer's approval, not an opportunistic edit. The mechanical
part is small; the care is in D2 — deciding, per site, which question is being asked.
