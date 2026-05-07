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

## Short-term focus

Make the host boundary concrete without prematurely building a full CLI or TUI.
The current `refarm tree` session/git/all slice should be treated as stable only
after `npm run refarm:tree:verify`; action-readiness envelope changes should pass
`npm run refarm:actions:verify`. CRDT mutation, composite mutation, rewind, and
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
   `npm run refarm:tree:verify`.
2. **Action-readiness internal boundary hardening** — deepen the action selection
   and readiness cluster (`actions`, Web/TUI/headless action rows,
   `action-affordances`, `status-actions`, and app-local `execution-plan`) while
   preserving dry-run/readiness-first semantics. Close with
   `npm run refarm:actions:verify`.
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
6. Keep a cheap guardrail for the unified host spine via `npm run refarm:host:smoke`,
   CLI flow smoke `npm run refarm:host:smoke:cli`, and CI wrapper
   `npm run refarm:host:smoke:ci`.

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
  `npm run actions:budget:guard:account`. Use allocation mode only as advisory
  fairness pressure: `npm run actions:budget:guard:allocation`.
- Disk is constrained; clean only when necessary.
- Avoid broad Rust rebuilds unless Rust is touched.
- Avoid broad markdown autoformat churn in large docs.
