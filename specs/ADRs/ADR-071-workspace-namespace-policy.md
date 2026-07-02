# ADR-071: Workspace Namespace Policy

**Status**: Accepted
**Date**: 2026-06-28
**Authors**: Arthur Silva, Codex
**Related**: ADR-022 (Policy Declarations in Plugin Manifests), ADR-046 (Blocks and Distros), ADR-056 (Unified Host Boundary), `docs/VAULT_SEED_CONVERGENCE.md`, `docs/DAILY_DRIVER_PARITY.md`

---

## Context

Refarm is both a reusable engine and one of its own daily-driver consumers. That creates a
namespace tension in the repository root:

- Refarm-local state naturally belongs under `.refarm/`.
- Project policy that must be reviewed by collaborators belongs in checked-in configuration such
  as `refarm.config.json`.
- Some external agent ecosystems create their own workspace surfaces. The current repo already has
  `.project/handoff.json` from Pi-oriented project workflows, `.pi/` monitors from the Pi stack,
  and `.pi-lens/` listed as local cache.
- Plugins may need writable workspace-local storage, but uncontrolled root-level directories make
  checkout state difficult to audit, especially for external consumers such as `vault-seed` and
  `agents-lab`.

The previous implicit split was not enough:

- `.refarm/` is ignored local operator state.
- `refarm.config.json` is versioned project policy.
- `.project/` is currently used as durable project handoff state, but it entered the repo through
  Pi workflows rather than a Refarm namespace decision.
- `workspaceProtection.roots` constrains protected root writes, but it is not a declaration model
  for plugin-owned folders.

We need a policy that keeps Refarm lean and auditable while still allowing Pi-like plugin freedom
when that freedom is explicit.

## Decision

Refarm will use **centralized defaults with declared exceptions** for workspace namespaces.

### Namespace classes

| Class | Default path | Git posture | Owner | Purpose |
|---|---|---|---|---|
| Project policy | `refarm.config.json` | checked in | project | Versioned intent, release policy, health policy, namespace declarations |
| Refarm sidecar state | `.refarm/` | ignored by default | Refarm operator/runtime | Caches, runtime state, local handoffs, sessions, locks, materialized checkouts |
| Source knowledge | `docs/`, `specs/`, source files | checked in | project | Durable architecture, contracts, user-visible docs, reproducible code |
| Declared external namespace | e.g. `.project/`, `.pi-lens/`, `.workflows/` | declared per namespace | declaring integration/plugin | External workflow state or cache that cannot honestly be represented as Refarm state |

The default answer for new Refarm-owned state is `.refarm/`. A new root-level directory is allowed
only when it is declared with owner, purpose, persistence, and access posture.

### Declaration model

Workspace namespace declarations may be supplied by project policy and, later, by plugin manifests.
The project-level policy is authoritative for the checkout.

Target shape:

```json
{
  "workspaceNamespaces": [
    {
      "path": ".project",
      "owner": "pi-project-workflows",
      "purpose": "durable project handoff and workflow coordination",
      "persistence": "versioned",
      "access": "readWrite"
    },
    {
      "path": ".pi-lens",
      "owner": "pi-lens",
      "purpose": "local lens cache",
      "persistence": "ignored",
      "access": "readWrite"
    }
  ]
}
```

Required fields:

- `path`: repository-root relative path. Root dot-directories are allowed only through this policy.
- `owner`: package, plugin, integration, or operator identity responsible for the namespace.
- `purpose`: concise reason the namespace exists.
- `persistence`: `versioned`, `ignored`, or `ephemeral`.
- `access`: `readOnly`, `readWrite`, or `generated`.

Optional future fields may include `schema`, `maxSizeBytes`, `allowedGlobs`, `denyGlobs`,
`cleanupTier`, and `conflictsWith`.

### Plugin freedom

Plugins may request workspace namespaces, but they do not silently receive them.

The host resolves plugin requests against project policy:

1. If the namespace is declared and compatible, grant the requested access.
2. If it is known but undeclared, warn and require explicit project policy before writing.
3. If it is unknown, default to deny for writes and allow read-only inspection only when the
   operator explicitly requested inspection.

This preserves the useful Pi pattern - plugins can own project-local surfaces - without letting
plugin side effects become invisible checkout drift.

### `.project/` status

`.project/` is treated as a **declared compatibility namespace**, not as the semantic center of
Refarm.

Refarm may continue reading and writing `.project/handoff.json` while dogfooding the Pi workflow
surface, but the durable rule is:

- Refarm-native local operator state belongs in `.refarm/`.
- Refarm-native versioned policy belongs in `refarm.config.json`.
- `.project/` remains an adapter/workflow namespace until a Refarm-native project-memory contract
  supersedes it or formally adopts it.

### Coding-agent state

The Refarm coding agent does not get a new root-level directory by default.

Refarm-owned coding-agent state should live under:

```text
.refarm/agents/
.refarm/sessions/
.refarm/handoff/
.refarm/runtime/
```

If another coding-agent provider needs a separate namespace, it must declare that namespace like
any other plugin/integration.

### Health and check posture

`refarm health` and `refarm check` should eventually audit workspace namespaces:

- declared namespace present and posture matches policy: pass;
- declared ignored namespace tracked by Git: warn or fail depending on policy;
- undeclared root dot-directory with writes: warn;
- undeclared generated/cache directory in a protected surface: fail when it risks reproducibility;
- read-only external checkout with attempted namespace creation: fail before writing.

This is separate from `workspaceProtection.roots`: protection says where guarded writes are allowed;
namespace policy says which roots are expected and why.

## Consequences

### Positive

- Refarm remains lean: most runtime and operator data stays under `.refarm/`.
- External workflows such as Pi project workflows and Pi Lens can coexist without being mistaken
  for Refarm core.
- Consumer repos can opt into Refarm behavior without receiving surprise root files.
- Health/check can distinguish expected side effects from real drift.
- Plugin authors get a path to workspace-local state that is auditable and reviewable.

### Negative

- Plugin integration becomes slightly more ceremony-heavy: writable workspace state needs a
  declaration.
- Existing `.project/` usage remains a compatibility bridge until a native project-memory contract
  lands.
- Some current docs and tests that assume `.project/` as intrinsic Refarm state will need wording
  updates.

### Risks

- If namespace declarations are too loose, they become a rubber stamp. Mitigation: health should
  require owner, purpose, persistence, and access for every non-default root.
- If declarations are too strict, useful ecosystem plugins become awkward. Mitigation: allow
  project-level policy to grant namespaces without requiring Refarm core changes.
- If `.refarm/` becomes a dumping ground, the sidecar will become hard to clean. Mitigation:
  require subdirectory ownership inside `.refarm/` and keep cleanup tiers in local disk hygiene
  docs.

## Alternatives Considered

### Put everything under `.refarm/`

This maximizes Refarm control but erases useful integration boundaries. It also makes Refarm look
like it owns state that actually belongs to another workflow provider.

### Let every plugin create its own root directory

This matches the most permissive Pi-style behavior but makes drift hard to audit and makes
read-only consumer calibration unsafe.

### Use only checked-in root config files

This is good for policy but bad for runtime state, caches, secrets, and large handoff artifacts.
It would also create noisy commits for operator-local behavior.

### Chosen: centralized defaults with declared exceptions

This keeps the default simple while preserving explicit escape hatches for real ecosystem
integration.

## Implementation

Affected components:

- `refarm.config.json`: add `workspaceNamespaces` when the schema and health checks are ready.
- `@refarm.dev/health`: audit declared, ignored, and unexpected workspace namespaces.
- `apps/refarm` project commands: treat `.project/` as a declared compatibility namespace and
  avoid assuming it is the only future handoff/project-memory location.
- Plugin manifest/policy packages: allow plugins to request workspace namespaces, resolved by host
  policy.
- Docs: update references that describe `.project/` as intrinsic Refarm state.

Migration path:

1. Record this ADR and keep current `.project/handoff.json` behavior stable.
2. Add a project-policy declaration for `.project/` and known ignored integration caches.
3. Teach `health/check` to report undeclared workspace namespaces without failing initially.
4. Promote warnings to failures only after existing Refarm, vault-seed, and agents-lab workflows
   have declarations.
5. Add plugin-manifest namespace requests and conflict detection.

Timeline: documentation decision now; health/check audit in the next hardening lane before broad
publication.

## References

- `docs/VAULT_SEED_CONVERGENCE.md` - sidecar state and external consumer posture.
- `docs/DAILY_DRIVER_PARITY.md` - current `.project/handoff.json` resume proof.
- `docs/PROCESS_PLAYBOOK.md` - `.refarm/` runtime files.
- `refarm.config.json` - current project policy and workspace protection roots.
- `.gitignore` - current ignored `.refarm/` and `.pi-lens/` posture.
