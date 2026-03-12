# ADR-042: Homestead Modularization & Multi-App Strategy

**Status**: ✅ ACCEPTED

## Context
Currently, `homestead` is a monolithic app acting as the "Refarm Studio". This creates coupling between the UI components, the engine orchestration, and the specific developer tools.

## Decision
We will refactor Homestead into a **Modular Shell Architecture** to support a versatile ecosystem of sovereign applications.

### 1. The Separation of Concerns
- **Tractor**: The Microkernel. Pure logic, no UI.
- **Homestead (Packages)**: The Desktop Environment. UI Components, Design System, Shell Orchestrator.
- **Refarm Apps (Distros)**: Specialized configurations.
  - `refarm.dev` (apps/dev): Mobile/Desktop Studio & IDE for plugin developers.
  - `refarm.me` (apps/me): Personal Sovereignty Hub for citizens.
  - `refarm.social` (apps/social): High-availability social networking.

### 2. Implementation Path
1. **Extract shared packages**: Move `StudioShell` logic to `@refarm.dev/homestead/sdk` and UI components to `@refarm.dev/homestead/ui`.
2. **Rename apps**: Rename `apps/homestead` to `apps/dev` to clarify its role as the developer distro.
3. **Guard workspace integrity**: Implement `type-check` and `astro check` on the root to ensure zero regressions across all distros during the modularization process.

## Rationale
This architecture allows Refarm to be everywhere without a "one size fits all" UI that feels bloated. It also allows developers to build their own "Refarm Distros" just by importing our UI and SDK packages.
