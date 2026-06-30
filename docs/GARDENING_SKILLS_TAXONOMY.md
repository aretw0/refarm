# Gardening Skills Taxonomy (Roadmap Item 6 — Discovery)

> Status: taxonomy ledger (2026-06-25). Maps `vault-seed`'s `dgk-skills` to Refarm engines and to
> `agents-lab` skills, to locate the "gardening skills" superset. The skill **contract** now exists
> as `@refarm.dev/skill-contract-v1`; runtime execution remains deferred. Refarm runs no skills yet.
> Feeds `docs/CONVERGENCE_ROADMAP.md` item 6.

## Where skills live today

- **`vault-seed` `@aretw0/dgk-skills`** (Pi `SKILL.md`): `vault-admin`, `vault-context`,
  `vault-create`, `vault-daily`, `vault-evaluate`, `vault-read`, `vault-search` — **vault-domain
  (gardening) skills**.
- **`agents-lab`**: `git-skills` (incl. `git-checkout-cache` = the librarian), `lab-skills`
  (agentic ops), `pi-skills` (Pi authoring), `web-skills` (`source-research`, `web-browser`). The
  Pi proving ground.
- **`refarm`**: **no executable skill surface yet.** It has a native contract package that parses
  `SKILL.md` into a policy-checkable manifest/invocation plan handoff, carries markdown I/O
  envelopes and declarative engine bindings, verifies loaded source integrity,
  and builds plugin-manifest-compatible `pi/skill` surface declarations. The
  plugin manifest now validates those `pi/skill` surfaces as package asset
  declarations before any host executes them. Refarm also has *engines* — `sower` (scaffold/import), `thresher`
  (integrity/compat audit), `windmill` (infra reconcile), `toolbox` (dev CLI), plus contracts
  (`context-provider-v1`, the in-progress `source:v1`). The skill invocation path is the future
  "Refarm as engine" milestone.

## The key finding

The convergence is **not** "move `dgk-skills` into Refarm." `dgk` vault-skills are thin **domain
wrappers**; in the converged world they call Refarm **engines** instead of reimplementing logic.
The taxonomy below is the mapping for when the skill host lands.

## Taxonomy — `dgk` vault-skill → Refarm engine/capability → `agents-lab` kin

| `dgk` skill | What it does | Refarm engine/capability it would call | `agents-lab` kin |
|---|---|---|---|
| `vault-create` | scaffold notes/structure | `sower` (scaffold/import engine) | `pi-skills/create-pi-*`, `project-intake` |
| `vault-read` / `vault-search` | read/find across the vault | **`source:v1`** (librarian, item 1) | `web-skills/source-research`, `git-checkout-cache` |
| `vault-context` | assemble context for a task | **`context-provider-v1`** (contract exists) | `lab-skills/cross-stack-intake` |
| `vault-evaluate` | quality/score notes | `thresher` (integrity audit) + Refarm text-quality scorer | `lab-skills/evaluate-extension`, `reality-check` |
| `vault-daily` | daily routine/digest | a routine/schedule (`windmill` / cron) | `lab-skills/session-triage`, `control-plane-continuity` |
| `vault-admin` | operate the vault | admin UI cockpit (`homestead` + `dgk serve`, item 4b) | `lab-skills/control-plane-ops` |

## The "gardening skills" superset

Skills for **tending a sovereign knowledge farm**, spanning: scaffold (`sower`), read/search
(`source:v1`), context (`context-provider-v1`), evaluate (`thresher`/text-score), routine
(`windmill`/schedule), admin (`homestead`). `dgk-skills` is the **vault-domain subset**;
`agents-lab` provides the **agentic-ops subset**; Refarm provides the **engines** the skills call.

Some engines already exist (`context-provider-v1`, `sower`, `thresher`; `source:v1` in progress);
the **skill host/runtime** that would invoke them does not.

## Native Refarm Skill Surface

The work is not only adopting existing skills. Refarm has started the native skill
surface with `@refarm.dev/skill-contract-v1`: it parses `SKILL.md`-style
content into `SkillManifestV1`, requires explicit capabilities, and builds a
host-policy-checkable invocation plan without executing tools. Manifests and
plans carry markdown input/output envelopes so hosts can validate payload shape
before policy or engine dispatch, and declarative engine bindings so hosts can
check required Refarm engine availability before dispatch. The contract can also
build a host-policy-checkable invocation request from a plan and markdown input
without calling a runtime, and can build a `layer: "pi", kind: "skill"` surface
declaration from a valid manifest plus relative package asset path. It exposes
`prepareSkillInvocationPlan` as the
adapter/host handoff for one source and `verifySkillSource` for source integrity
checks before host trust. `@refarm.dev/plugin-manifest` validates that package
surface as a non-UI, capability-declared `SKILL.md` asset declaration. The
remaining runtime work is to pass that plan through policy and invoke Refarm engines
through `runtime-agent`, `pi-agent`, or another Refarm plugin host. The durable
owner should remain a package/plugin manifest surface, not `apps/refarm`.

This must not become a second plugin system. Packages remain the distribution
unit, plugins remain the executable/capability providers, and skills are
agent-facing workflow surfaces or assets declared by that package. A package may
bundle `SKILL.md`, guides, references, themes, and code extensions together; the
manifest decides which host can see each surface.

Activation sequence:

1. **done:** create the contract package for skill metadata, capability
   declarations, source hash, policy-checkable invocation plan/request, and
   package surface declaration helper, scoped as a schema helper for
   plugin-declared skill surfaces;
2. add a minimal adapter that maps one reviewed external skill into the
   policy-checkable invocation plan;
3. represent that skill as a manifest-declared surface such as
   `layer: "pi", kind: "skill"` with `assets` pointing to the `SKILL.md`;
4. run the first dogfood smoke through `runtime-agent` or a Refarm plugin
   without bypassing plugin-manifest/Barn/Scarecrow boundaries;
5. only then install, vendor, or publish skill wrappers.

## Deferred Until Native Host Exists

- **External skill adapters** (`SKILL.md` → Refarm manifest/runtime): the
  `VAULT_SEED_CONVERGENCE.md` "skill compatibility" promotion candidate. Deferred until Refarm has
  its own manifest surface and invocation host — otherwise it is supply-ahead-of-consumption,
  against the dogfooding gate. Tracked under the "Refarm as engine" milestone.
- **`dgk-skills` stays in `vault-seed`** (canonical to DGK); it conforms to the future contract,
  it does not migrate.

## Agents-lab Markdown Skill Import Manifest

`pnpm run agents-lab:skills:manifest` emits a plan-only import manifest for the
current `agents-lab` Markdown skill candidates:

- `git-skills`;
- `lab-skills/cultivate-primitive`;
- `lab-skills/evaluate-extension`;
- `lab-skills/provider-model-discovery`.

The manifest does not install or vendor files. It requires convention review for
each skill, keeps Pi TypeScript extension APIs out of scope, and preserves the
deferred skill-runtime boundary above. This lets Refarm start aligning with
`agents-lab` skill content without pretending the Refarm skill invocation surface
exists yet.

This is not an indefinite hold. The next work can start now: review the Markdown
skill sources and record accepted content or required edits. A real skill adapter
is unlocked when one reviewed skill maps to an existing Refarm engine/capability,
a minimal invocation surface can execute a `SKILL.md`-derived plan without
bypassing policy, and a dogfood smoke records the selected skill's engine calls
and input/output envelope.

`pnpm run agents-lab:skills:review` is the first source-review checkpoint. It
reads the local `agents-lab` checkout (or `AGENTS_LAB_SOURCE_DIR`) and records
file paths, SHA-256 hashes, frontmatter, and installation decisions without
copying files:

| Candidate | Source reviewed | Current decision |
|---|---|---|
| `git-skills` | `packages/git-skills/skills/git-workflow/SKILL.md` | Accepted only after Refarm convention review. This is the first likely skill text for a future invocation smoke. |
| `lab-skills/cultivate-primitive` | `packages/lab-skills/skills/cultivate-primitive/SKILL.md` | Requires Refarm edits before installation: replace Pi package/runtime wording with Refarm package, WIT, policy, and docs boundaries. |
| `lab-skills/evaluate-extension` | `packages/lab-skills/skills/evaluate-extension/SKILL.md` | Requires Refarm edits before installation: generalize Pi extension scoring into Refarm package/plugin/skill placement review. |
| `lab-skills/provider-model-discovery` | `packages/lab-skills/skills/provider-model-discovery/SKILL.md` | Requires Refarm edits before installation: preserve report-only guardrails, but move settings/routes/tests to Refarm runtime, Silo, and budget handoff terms. |

That makes the skills track active without coupling Refarm to the `agents-lab`
product runtime. Source review is allowed now; installation, vendoring, or
runtime execution still waits for convention review plus the dogfood invocation
gate.

`pnpm run agents-lab:skills:conventions` is the convention gate for the first
candidate, `git-skills/git-workflow`. The current result is intentionally not
"install now": upstream `git-workflow` aligns with non-interactive git safety
(`git commit -m`, `GIT_EDITOR=true`, `git merge --no-edit`,
`GH_PROMPT_DISABLED=1`), but it does not carry Refarm's operator-loop and source
sovereignty rules. The decision is therefore
`requires-refarm-wrapper-before-install`.

The wrapper must prepend Refarm-specific invariants before any future skill
adapter smoke:

- start each slice with `refarm resume --json` and
  `refarm check --next-action --json`;
- after edits, commits, or public JSON/CLI contract changes, run the matching
  `refarm agent finish` lane and follow `nextCommands`;
- preserve source sovereignty and avoid generated artifacts;
- require explicit confirmation for destructive or wide-impact git operations.

This keeps `agents-lab` as source evidence and Refarm as the neutral supplier of
the execution boundary.
