# Refarm Work Focus

Use this as a restart note when returning to the project after context resets.

For canonical runtime boundary and observability posture, see [Refarm Engine Boundary & Telemetry Guide](./REFARM_ENGINE_BOUNDARY_AND_TELEMETRY.md).

## Current north star

Refarm is moving toward a unified `refarm` host experience: one product command
and runtime posture that can expose Web, headless, and later TUI renderers over
the same plugin/surface/action/telemetry contracts.

The CLI product should be named `refarm` and live as a distro under
`apps/refarm`. Packages remain reusable blocks. This preserves Refarm's
composition model: apps make product choices; packages provide primitives.

## 2026-06 release focus

Treat `v0.1.0` as an earned reliability label, not as a calendar milestone. The
useful cut is three lanes:

| Lane | Purpose | Release posture |
| --- | --- | --- |
| Release Kernel | Small reusable contracts and SDK primitives: storage, sync, identity, artifacts, process handoffs, dispatch surfaces, provenance, health, and policy envelopes. | Publish only when conformance, docs, and consumer-neutral boundaries are clear. |
| Daily Driver | The `refarm` command, runtime readiness, finish gates, sessions, plugin lifecycle, model credentials, logs, recovery, and local operator UX. | Gates public version confidence; must work for the creator before broad promises. |
| Lab | POCs, benchmark harnesses, `vault-seed`, `agents-lab`, external workspaces, and prize-writing evidence pressure. | Feeds reusable primitives back into Refarm without making consumer UX part of core. |

This keeps convergence productive: Refarm becomes the shared substrate, while
consumer projects keep their vocabulary, publishing surface, and local workflow.
Do not promote a lab pattern into the Release Kernel until a second consumer or
the daily-driver loop needs the same primitive.

### Current consolidation checkpoint

The active consolidation slice has enough surface area. Treat the current work
as a set of release-review slices to stabilize, not as permission to add another
control plane:

1. Release planning: `@refarm.dev/release-engine` is the reusable primitive;
   `refarm release` is the operator surface.
2. Workspace execution: `@refarm.dev/cli` owns product-neutral executor/cache
   discovery; `apps/refarm` owns JSON handoffs and operator commands.
3. Toolchain hygiene: pnpm 11 policy lives in workspace-level config, with
   package validation guarding against stale `package.json > pnpm` policy.
4. Test runner boundaries: Vitest handles Vite/workspace suites; `node:test`
   stays for Node-native CI scripts.
5. Environment substrate: derived artifact ownership is now a substrate check.
   A checkout should have one coherent execution owner; clean ignored outputs
   when environments are mixed instead of adding source workarounds.

Next work should close these slices with tests, docs, and atomic commits before
expanding runtime behavior. The strongest release signal remains:

```bash
refarm release check --selection default --dry-run --json
refarm agent finish --lane after-edit --run --json
```

The current container/host friction is a valid product signal. Refarm should
eventually make external workspace and cache inspection boring through explicit
profiles, read-only posture, structured handoffs, and capability-scoped bridges
instead of relying on ad hoc mounts or host-specific path knowledge. Until that
exists, treat adjacent checkouts and Windows-host paths as external consumers:
inspect read-only when mounted, never write silently, and record reusable
pressure as Refarm docs or contracts.

Daily-driver validation must be workspace-portable. Refarm should not make the
operator remember whether a project uses Turbo, Nx, Make, Cargo, or only package
scripts. The CLI should discover the workspace execution surface, select an
adapter, report cache/provisioning status, and fall back explicitly when a tool
is not declared. Turbo is one adapter for cache-aware JavaScript monorepos, not
Refarm's semantic contract.

Concrete operator loop for external workspaces:

```bash
refarm workspace execution --cwd ../agents-lab --json
refarm workspace execution --cwd ../greenhouse/vault-seed --json
refarm agent finish --templates --json
```

`workspace execution` is the read-only probe for executor/cache readiness. It
reports the selected executor, Turbo adapter availability when present, local
cache presence, remote cache configuration, and any adapter installation handoff.
External-consumer templates should stay read-only (`effects: ["observe"]`,
`writes: false`) until a human chooses a concrete validation or provisioning
command. Prefer `--cwd <dir>` for cross-checkout probes so container/host
bridges do not require changing shell state.

The reusable discovery logic lives in `@refarm.dev/cli/workspace-execution`.
The reusable declared-workspace sweep logic lives in
`@refarm.dev/cli/workspace-sweep`, which resolves declared paths and bridges,
builds compact summaries, and emits stable recommendations without depending on
the `refarm` app. Its reusable payload is the command-neutral
`{ mode, summary, recommendations, observations }` object; `apps/refarm` adds
product shell concerns such as `command`, `operation`, `ok`, JSON handoff fields,
check recommendations, and provisioning commands. Keep executor/cache discovery
product-agnostic unless a consumer proves it needs a Refarm-specific policy
hook.

Workspace declarations belong in `.refarm/config.json` under `workspaces`.
Each entry is intent, not observed state:

```json
{
  "workspaces": {
    "agents-lab": {
      "path": "../agents-lab",
      "kind": "lab",
      "execution": { "preferredAdapter": "auto" }
    }
  }
}
```

Use `refarm workspace list --json` to inspect configured workspaces and
`refarm workspace execution --workspace <id> --json` to observe a declared
workspace without manually changing shell directories. Use
`refarm workspace execution --all --json` for a read-only control-plane sweep
across every declared workspace; missing paths are reported per observation
instead of turning the whole command into a write or recovery action.

For container/host boundaries, workspace entries can include filesystem bridge
candidates:

```json
{
  "workspaces": {
    "agents-lab": {
      "path": "../agents-lab",
      "bridges": [
        {
          "id": "windows-host",
          "kind": "filesystem",
          "path": "/mnt/c/Users/aretw/Documents/GitHub/agents-lab",
          "hostPath": "C:\\Users\\aretw\\Documents\\GitHub\\agents-lab",
          "mountHint": "Mount the Windows checkout into this container."
        }
      ]
    }
  }
}
```

`workspace execution --all --json` reports the declared path, bridge candidates,
which candidates exist, and the resolved path used for observation. The same
payload includes a compact `summary` plus stable `recommendations` so agents can
decide whether the next step is mounting a workspace, installing an adapter, or
provisioning remote cache without scraping every observation manually. When a
recommendation has an executable `nextCommand`, the app-level JSON envelope also
promotes it into `nextCommands`; mount hints stay as recommendation data because
they are environment actions, not shell commands.

Mounts are the heavy path: use them when the operator needs the real host
checkout visible inside the devcontainer for editing or running that checkout in
place. For read-heavy use cases such as reference lookup, benchmark discovery,
agent context, and cross-project analysis, prefer source materialization into
Refarm's managed checkout cache. Declared workspaces can include repository
intent:

```json
{
  "workspaces": {
    "agents-lab": {
      "path": "../agents-lab",
      "repository": {
        "url": "https://github.com/example/agents-lab.git",
        "ref": "develop"
      }
    }
  }
}
```

`refarm workspace sources --json` is the read-only plan for that layer. It uses
a stable checkout cache under `.refarm/cache/checkouts/<host>/<owner>/<repo>`,
plans partial clones with `--filter=blob:none`, reports a throttled refresh
window, and never requires a devcontainer rebuild. Treat the shared checkout
cache as an observation cache: read from it freely, but create a worktree or a
separate editable checkout before making task-specific writes.
`refarm check --json` includes the same declared-workspace sweep as
`checks.workspaceSweep`; missing consumer checkouts are warnings, not blocking
readiness failures, because external workspaces may simply be unmounted in the
current container.
`refarm agent --json` exposes the sweep as `environment.workspaceSweep`, and
`refarm agent finish --templates --json` includes the read-only
`declared-workspaces-execution-all-json` template for agents that need the full
declared-workspace control-plane signal before choosing work.

## Short-term focus

Make the host boundary concrete without prematurely building a full CLI or TUI.
The current `refarm tree` session/git/all slice should be treated as stable only
after `pnpm run refarm:tree:verify`; action-readiness envelope changes should pass
`pnpm run refarm:actions:verify`. CRDT mutation, composite mutation, rewind, and
execution-plan extraction stay deferred behind the proof gates in
[Refarm Tree Primitive](./REFARM_TREE_PRIMITIVE.md).

### Current ROI path

The highest-return path is to harden the host contract from both directions at
once:

- **Top-down**: preserve the unified host direction — one `refarm` distro with
  Web, headless, and future TUI renderers over shared semantic contracts.
- **Bottom-up**: reduce concrete friction in the modules already carrying those
  contracts, before adding larger behavior surfaces.

Work through these slices in order unless a production failure demands a detour:

1. **Tree internal boundary hardening** — deepen the `refarm tree` module cluster
   (`tree.ts`, `tree-git.ts`, `tree-session.ts`, `tree-model.ts`, session ID/lock
   helpers) without changing the JSON contract. Prefer extracting internal
   builders/adapters for envelopes, preview/result effects, scope guards, and
   substrate-specific facts. Validate with the granular tree lanes and close with
   `pnpm run refarm:tree:verify`.
2. **Action-readiness internal boundary hardening** — deepen the action selection
   and readiness cluster (`actions`, Web/TUI/headless action rows,
   `action-affordances`, `status-actions`, and app-local `execution-plan`) while
   preserving dry-run/readiness-first semantics. Close with
   `pnpm run refarm:actions:verify`.
3. **Action result envelope proof** — only after readiness is internally stable,
   add the smallest app-owned execution/result envelope that can be consumed by
   headless/Web/future TUI without moving product semantics into packages.
4. **Smoke/CI economy polish** — improve local routing explanations or JSON only
   when iteration pain appears; do not broaden CI by default.
5. **Larger host/TUI/product behavior** — defer until the tree/action seams are
   deep enough that new behavior does not fork runtime policy.

Do **not** use these slices as permission to add CRDT mutation, composite
mutation, rewind, or package extraction early. Those remain proof-gated.

1. Keep the shared renderer vocabulary healthy:
   - `@refarm.dev/homestead/sdk/host-renderer` owns renderer kinds,
     capabilities, descriptors, and capability checks.
   - Existing consumers are `apps/dev` Web/headless and `apps/me` Web.
2. Stabilize headless output:
   - define the stable JSON shape for `refarm status` / headless snapshots;
   - derive data from semantic telemetry, trust status, surfaces, actions,
     streams, and diagnostics;
   - avoid DOM or browser-only assumptions.
3. Document before scaffolding:
   - keep `docs/REFARM_CLI_DISTRO.md` as the CLI product plan;
   - only scaffold `apps/refarm` once the first status/headless contract is clear.
4. Continue small frontend/platform slices:
   - app code incubates product behavior;
   - Homestead receives semantic runtime mechanics;
   - DS receives repeated visual primitives.

## Medium-term focus

Turn the documented `refarm` distro into the smallest useful product command.

1. Create `apps/refarm` as the installable CLI distro.
2. Implement boring initial commands:
   - ✅ `refarm status` for runtime/renderer/plugin/trust/disk summary;
   - ✅ `refarm headless` for machine-readable diagnostics;
   - ✅ `refarm web` renderer preflight + launcher entrypoint (`--launch`, `--launcher dev|preview`, optional `--dry-run`, `--open`, `--open-url`) with fail-closed status diagnostics;
   - ✅ `refarm doctor` for preflight checks.
3. Keep the CLI thin:
   - command UX, defaults, profiles, and release packaging stay in `apps/refarm`;
   - reusable mechanics move only when duplicated or clearly stable.
4. Keep Web as the default human interface while headless matures for automation.
5. Delay full TUI package extraction until Web/headless contracts create real pressure.
   `refarm tui` can expose launch entrypoints (`--launch`, optional `--dry-run`),
   but must not fork runtime policy from shared status diagnostics.
6. Keep a cheap guardrail for the unified host spine via `pnpm run refarm:host:smoke`,
   CLI flow smoke `pnpm run refarm:host:smoke:cli`, and CI wrapper
   `pnpm run refarm:host:smoke:ci`.

## Long-term focus

Make Refarm a sovereign agentic host that can eventually replace direct Pi usage
for Refarm work.

1. One host/runtime posture:
   - plugins write intent/data through Tractor contracts;
   - host executes actions and enforces trust;
   - renderers present the same state in Web, headless, or TUI.
2. Agent loop on Refarm primitives:
   - sessions, messages, tool calls, and forks become graph/CRDT concepts;
   - timeline/fork UX follows the substrate-agnostic [Refarm Tree Primitive](./REFARM_TREE_PRIMITIVE.md);
   - file/shell/model/tool operations run through auditable host actions;
   - plugin surfaces show state and ask for host actions instead of owning power.
3. TUI when justified:
   - terminal panes/status/actions consume the same renderer contract;
   - no separate runtime policy for TUI.
4. Marketplace/trust maturity:
   - external surfaces remain trust-gated;
   - registry/revocation diagnostics stay auditable;
   - host policies are profile-driven and visible to users/agents.

## Operating rules

- Source is truth; do not edit generated artifacts.
- Work in atomic slices with local validation.
- Do not push/watch CI after every small slice; batch meaningful work.
- Before push/PR, use the account Actions guard for the hard monthly quota signal:
  `pnpm run actions:budget:guard:account`. Use allocation mode only as advisory
  fairness pressure: `pnpm run actions:budget:guard:allocation`.
- Disk is constrained; clean only when necessary.
- Avoid broad Rust rebuilds unless Rust is touched.
- Avoid broad markdown autoformat churn in large docs.
