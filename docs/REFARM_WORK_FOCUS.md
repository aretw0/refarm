# Refarm Work Focus

Use this as a restart note when returning to the project after context resets.

## Current north star

Refarm is moving toward a unified `refarm` host experience: one product command
and runtime posture that can expose Web, headless, and later TUI renderers over
the same plugin/surface/action/telemetry contracts.

The CLI product should be named `refarm` and live as a distro under
`apps/refarm`. Packages remain reusable blocks. This preserves Refarm's
composition model: apps make product choices; packages provide primitives.

## Short-term focus

Make the host boundary concrete without prematurely building a full CLI or TUI.

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
   - `refarm status` for runtime/renderer/plugin/trust/disk summary;
   - `refarm headless` for machine-readable diagnostics;
   - `refarm web` for launching the local Homestead/Web experience;
   - `refarm doctor` for preflight checks.
3. Keep the CLI thin:
   - command UX, defaults, profiles, and release packaging stay in `apps/refarm`;
   - reusable mechanics move only when duplicated or clearly stable.
4. Keep Web as the default human interface while headless matures for automation.
5. Delay TUI package extraction until Web/headless contracts create real pressure.

## Long-term focus

Make Refarm a sovereign agentic host that can eventually replace direct Pi usage
for Refarm work.

1. One host/runtime posture:
   - plugins write intent/data through Tractor contracts;
   - host executes actions and enforces trust;
   - renderers present the same state in Web, headless, or TUI.
2. Agent loop on Refarm primitives:
   - sessions, messages, tool calls, and forks become graph/CRDT concepts;
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
- Disk is constrained; clean only when necessary.
- Avoid broad Rust rebuilds unless Rust is touched.
- Avoid broad markdown autoformat churn in large docs.
