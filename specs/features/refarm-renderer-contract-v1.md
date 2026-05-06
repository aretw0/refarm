# Feature: refarm-renderer-contract-v1 — Unified renderer contract for Web/TUI/headless

**Status**: In Progress  
**Version**: v0.1.0  
**Owner**: Refarm core

---

## Summary

Define one renderer contract shared by `refarm web`, `refarm tui`, and
`refarm headless` so each mode presents the same host/runtime/trust state while
keeping modality-specific UX independent.

This spec operationalizes [ADR-056](../ADRs/ADR-056-unified-refarm-host-boundary.md)
with explicit conformance expectations.

---

## User Stories

**As a** Refarm user  
**I want** consistent host diagnostics across renderer modes  
**So that** I can switch between Web/TUI/headless without semantic drift.

**As a** Refarm maintainer  
**I want** a stable renderer capability vocabulary  
**So that** launch guards and status checks stay deterministic.

**As a** package maintainer  
**I want** renderer semantics owned in `packages/*`  
**So that** app distros can compose behavior without reimplementing runtime policy.

---

## Acceptance Criteria

1. **Given** a renderer descriptor produced from
   `@refarm.dev/homestead/sdk/host-renderer`  
   **When** `refarm status --renderer <kind> --json` is executed  
   **Then** payload `renderer.kind` and `renderer.capabilities` match the descriptor.

2. **Given** `renderer=headless`  
   **When** status diagnostics are classified  
   **Then** non-interactive diagnostics are expected (`renderer:non-interactive`,
   `renderer:no-rich-html`) and are treated as informational unless overridden.

3. **Given** runtime/trust pressure (`runtime.ready=false`, trust critical > 0)  
   **When** any renderer mode (`web|tui|headless`) runs preflight  
   **Then** failure diagnostics are identical and launch is blocked fail-closed.

4. **Given** renderer launch flags (`--launch`, `--dry-run`) in `web` or `tui`  
   **When** incompatible flags are provided  
   **Then** guardrail errors are deterministic and mode-agnostic.

5. **Given** status exposes `plugins.availableActions`
   **When** renderer-neutral host, Web, headless, or TUI action-readiness views are requested
   **Then** they use stable action IDs and one-based row selections from the status contract rather than DOM selectors or product-private payloads.

6. **Given** a live `apps/refarm` status action is selected explicitly
   **When** `refarm status --action <id-or-index>` is executed
   **Then** the command resolves the same live status affordance vocabulary, rejects `--input` artifact authorization, invokes the app-owned handler through the Homestead action envelope, and reports deterministic `statusSource: "live"` plus handled/unhandled metadata.

---

## Technical Approach

### Canonical vocabulary (already in source)

Contract source of truth:

- `packages/homestead/src/sdk/host-renderer.ts`
  - `HomesteadHostRendererKind`: `web | tui | headless`
  - `HomesteadHostRendererCapability`:
    `surfaces | surface-actions | host-context | streams | telemetry | diagnostics | interactive | rich-html`
  - `HomesteadHostRendererSnapshot` as portable renderer state envelope.

### Current host integration

- `packages/cli/src/status.ts`
  - builds `RefarmStatusJson`
  - derives diagnostics from renderer capabilities + runtime/trust/plugin/stream state
- `apps/refarm/src/commands/{web,tui,headless}.ts`
  - share one preflight path
  - enforce launch fail-closed on canonical diagnostics.

### Conformance profile by renderer kind

| Kind       | Required capabilities                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `web`      | `surfaces`, `surface-actions`, `host-context`, `streams`, `telemetry`, `diagnostics`, `interactive`, `rich-html` |
| `tui`      | `surfaces`, `surface-actions`, `host-context`, `streams`, `telemetry`, `diagnostics`, `interactive`              |
| `headless` | `surfaces`, `surface-actions`, `host-context`, `streams`, `telemetry`, `diagnostics`                             |

---

## API/Interface

```typescript
// packages/homestead/src/sdk/host-renderer.ts
export interface HomesteadHostRendererDescriptor {
  id: string;
  kind: "web" | "tui" | "headless";
  capabilities: readonly HomesteadHostRendererCapability[];
}

export interface HomesteadHostRendererSnapshot {
  renderer: HomesteadHostRendererDescriptor;
  surfaces?: HomesteadHostSurfaceState;
  streams?: HomesteadHostStreamState;
  telemetryEvents?: readonly string[];
  diagnostics?: readonly string[];
}
```

```typescript
// packages/cli/src/status.ts
export interface RefarmStatusJson {
  schemaVersion: 1;
  renderer: { id: string; kind: string; capabilities: readonly string[] };
  runtime: RuntimeSummary;
  trust: TrustSummary;
  plugins: {
    installed: number;
    active: number;
    rejectedSurfaces: number;
    surfaceActions: number;
    availableActions?: readonly {
      id: string;
      label: string;
      intent?: string;
    }[];
  };
  streams: { active: number; terminal: number };
  diagnostics: string[];
}
```

---

## Test Coverage

**Current evidence (implemented):**

- [x] `packages/cli/src/status.test.ts` verifies renderer-derived diagnostics
- [x] `apps/refarm/test/commands/{web,tui,headless,status}*.test.ts` validate preflight/guard behavior
- [x] `apps/refarm/test/commands/status.test.ts` verifies `refarm status --renderer <kind>` forwards each descriptor/capability profile and app-owned live status affordances to status building
- [x] `packages/homestead/src/sdk/host-renderer.test.ts` verifies required renderer capability profiles and `runHostRendererConformance(kind, descriptorFactory)`
- [x] `apps/refarm/test/commands/renderers.test.ts` verifies the distro renderer catalog conforms to Homestead profiles
- [x] `apps/refarm/test/commands/headless-action.test.ts` verifies headless action request envelopes use the shared Homestead action helper path
- [x] `apps/refarm/test/commands/status-surfaces.test.ts` verifies live `apps/refarm` status affordances are exposed as a Homestead surface-state snapshot
- [x] `apps/refarm/test/commands/status-actions.test.ts` verifies live `apps/refarm` status actions resolve, invoke, and emit deterministic invocation envelopes through the shared Homestead action envelope
- [x] `apps/refarm/test/commands/status.test.ts` verifies `refarm status --action <id-or-index>` invokes live status actions by ID and row index
- [x] `apps/refarm/test/commands/action-affordances.test.ts` verifies the app-owned shared action affordance vocabulary, selected-row formatting, and dry-run envelope construction used by renderer-neutral host, Web/headless/TUI readiness paths
- [x] `apps/refarm/test/commands/actions.test.ts` verifies `refarm actions` exposes non-executing host action rows, selected-row metadata, and JSON dry-run envelopes over `plugins.availableActions`
- [x] `apps/refarm/test/commands/web-actions.test.ts` verifies Web action rows, selected-row output, and JSON dry-run envelopes are derived from `plugins.availableActions`
- [x] `apps/refarm/test/commands/tui-actions.test.ts` verifies TUI action rows, selected-row output, and JSON dry-run envelopes are derived from `plugins.availableActions`
- [x] `apps/refarm/test/commands/action-fixture.test.ts` verifies one status fixture drives renderer-neutral host action rows/JSON, headless action envelopes, indexed selection, Web/TUI action rows, selected Web/TUI rows, and Web/TUI JSON dry-run envelopes through `--input`
- [x] `npm run refarm:host:smoke:dist-actions` verifies the emitted `apps/refarm/dist/index.js` can discover Web actions, emit renderer-neutral `refarm actions` dry-run output, and execute a live status action through the built package graph

**Next conformance additions (planned):**

- [ ] Add CI smoke step asserting `refarm status --renderer <kind> --json` parity after Actions budget recovers

---

## Implementation Tasks

**SDD**

- [x] Canonicalize renderer kinds/capabilities in Homestead SDK
- [x] Document v1 renderer contract and conformance profile (this spec)

**TDD**

- [x] Add host-renderer conformance harness in `packages/homestead`
- [x] Add renderer parity tests in `apps/refarm` for all kinds

**DDD**

- [x] Expose reusable conformance helper from Homestead SDK
- [x] Expose local renderer-neutral host/Web/headless/TUI action-readiness views over `plugins.availableActions`
- [ ] Wire conformance smoke to CI host lane

---

## References

- [ADR-056: Unified refarm host boundary](../ADRs/ADR-056-unified-refarm-host-boundary.md)
- [Refarm Host Model](../../docs/REFARM_HOST_MODEL.md)
- [Refarm CLI Distro Plan](../../docs/REFARM_CLI_DISTRO.md)
- [Refarm Status Output](../../docs/REFARM_STATUS_OUTPUT.md)
- [Refarm Action Readiness Cookbook](../../docs/REFARM_ACTION_READINESS_COOKBOOK.md)
- [packages/homestead/src/sdk/host-renderer.ts](../../packages/homestead/src/sdk/host-renderer.ts)
- [packages/cli/src/status.ts](../../packages/cli/src/status.ts)
