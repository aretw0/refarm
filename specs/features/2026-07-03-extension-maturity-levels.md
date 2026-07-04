# Spec: Extension Maturity Levels (permissive authoring → publish-ready)

**Status:** DRAFT — Decision #1 landed end-to-end (form is permissive by default);
Decisions #2–#5 pending. Reviewed by Arthur Silva.
**Date:** 2026-07-03 (updated 2026-07-04)
**Related:** `docs/EXTENSIBILITY_MODEL.md` (Authoring Spaces Before Packaging),
`packages/skill-contract-v1`, `packages/plugin-surface-loader`,
`packages/plugin-manifest` (ExtensionSurfaceDeclaration),
[[modelo-pontos-extensao]], [[tracks-t1-t2-t3-convergencia]]

## Update 2026-07-04 — form vs. policy; the evaluator is plural

Decision #1 ("contracts validate shape, not completeness") is now consistent
end-to-end. The permissive rule was enforced inconsistently across three points —
`parseSkillMarkdown` accepted zero capabilities, but `validateSkillSurfaceDeclaration`
(`skill-contract-v1/manifest.ts`) and `validatePiSkillSurface`
(`plugin-manifest/validate.js`) still **rejected** them, so a permissive skill
parsed yet could not become a surface. Both are now loosened: capabilities are
validated for FORM only (valid ids when present; omission/empty is fine).

The sharper framing (Arthur): **validation validates FORM — "is this a well-formed
skill that can happen?" — and defaults to permissive so things happen.** Whether a
skill *should* declare capabilities (or meets a quality/integrity bar) is a
**POLICY** judgement, and policy is a **plural, extensible evaluator layer**, not a
single auditor. `health`, `quality`, `design-tells`, `text-tells` (and future,
including plugin-contributed) each evaluate the same artifact and raise
warnings/findings — some are encouragement ("declare capabilities"), some flag real
problems. Each finding is a **pending-action resolvable on the tri-interface**
(CLI + REPL `/slash` + conversational agent), exactly like Decision #3. This
generalizes Decision #2's `classifyExtensionMaturity` into one instance of a neutral
`PolicyEvaluator: (artifact) => { findings }` contract (a dedicated future slice —
do NOT couple it to `health`). Requiring completeness inside a form check both
blocks the flow and mis-layers the concern.

---

## Problem

Every extension surface (skill, theme, command, tool, …) exists on a spectrum
from **local/adhoc** (a draft a user writes for one project, like a pi/claude-code
`SKILL.md` with just `name` + `description`) to **publish-ready** (declared
capabilities, integrity, policy). The refarm contracts today gate at the strict
end: `validateSkillManifest` (via `validateCapabilities`, manifest.ts) passes
`requireNonEmpty: true` on `capabilities.requires`, so a skill without declared
capabilities is **rejected**. Verified: **0 of 29** real pi skills in agents-lab
declare `requiredCapabilities`, so the refarm loader cannot load any of them.

`EXTENSIBILITY_MODEL.md` already stages authoring (User → Project → Package →
Release, lines 82-95) and says local work must stay private and mutable — but
line 97-99 also states "a local skill still needs... declared capabilities,"
which contradicts the adhoc-authoring goal and is the exact friction that rejects
real-world skills. This spec resolves that contradiction.

## Principle: permissive by default, matured on the way up

Loading an extension must have **zero friction for adhoc/local work** and offer a
**path to maturation** for serious use. Maturity is a property orthogonal to the
authoring stage: a surface is loaded at whatever completeness it has, and the host
(and the REPL agent) guide the author to complete it, rather than refusing it.

Two maturity levels, per surface:

- **`permissive`** — the minimum to be *addressable*: a skill has `name` +
  `description` + body; a theme has an `id`; a command has a `name` + args. It
  loads and works. It carries **warnings** naming what is undeclared (e.g. "no
  capabilities declared — runs without a capability gate"). This is the pi /
  claude-code / user-adhoc default.
- **`complete`** — everything a shareable contract needs: declared capabilities,
  source integrity (sha256), policy envelope. No warnings. This is what
  Package/Release stages require.

The stages of `EXTENSIBILITY_MODEL.md` map to a **minimum required maturity**:
User/Project space accept `permissive`; Package/Release require `complete`. So the
contract does not reject — it *classifies*, and the packaging/release step is where
`complete` becomes mandatory (a `permissive` surface cannot be published until its
classification is finished).

## Decisions

1. **Contracts validate shape, not completeness.** `requiredCapabilities` (and
   equivalent "serious-use" fields) become **optional** in the parse/validate step.
   A skill with no capabilities is a *valid* `SkillManifestV1` at `permissive`
   maturity. Concretely: drop `requireNonEmpty: true` from `validateCapabilities`
   for `requires`. Verified safe — the activation preflight only iterates
   `capabilities.requires` (manifest.ts:491), so an empty list simply skips the
   gate rather than crashing.

2. **Maturity is computed, warnings are data.** A `classifyExtensionMaturity`
   step returns `{ maturity: "permissive" | "complete", warnings: string[] }`.
   Warnings are structured (code + message), never thrown. The loader attaches
   them to each loaded surface. This lives at the loader/host layer
   (`plugin-surface-loader`), not inside the pure contract — the contract stays a
   yes/no shape check; maturity is a host judgement.

3. **The host guides maturation, resolvable on every surface.** When a session
   runs "seriously" (a heuristic the host owns — e.g. a publish attempt, or an
   operator opt-in), the host surfaces the warnings. A maturity warning is a
   **pending action**, and — like every action in refarm — it must be resolvable
   in all three ways the user might reach for: a **CLI command** (`refarm ...`), a
   **REPL `/slash`**, and **conversationally with the agent**. This is exactly the
   tri-surface capability registry already built
   (`packages/cli/src/capabilities` + the app registry): the "finish this skill's
   classification" action is a `CapabilityDescriptor` (declared once), so the
   operator can run it from the CLI, the REPL agent can suggest and invoke it via
   its slash form, and a conversational request routes to the same descriptor. No
   surface-specific resolution path; one declared action, three ways to reach it.
   Adhoc runs stay quiet; the suggestion is opt-in, not nagging.

4. **Publishing requires `complete`.** The Package/Release lanes reject a
   `permissive` surface (its warnings become blocking there). This is where the
   strictness the old contract imposed everywhere correctly lives — at the
   share-a-contract boundary, not the write-a-draft boundary.

5. **Same model for every surface.** Theme (conformant tokens = `complete`;
   partial = rejected today, but could be `permissive` with a fallback later),
   command, tool — each defines what `permissive` vs `complete` means, but the
   two-level shape + warnings + publish-gate is shared. Skill is the first
   implementation; the others adopt it as they gain loaders.

## Non-goals

- Not a new policy engine — the capability gate (`decidePluginPolicy`,
  `evaluateSkillActivationPreflight`) is unchanged; it just becomes a no-op when a
  permissive surface declares nothing to gate.
- Not making draft skills auto-executable with host authority — a permissive skill
  is *addressable/model-invoked*, still behind the same activation decision before
  any host-mediated effect.
- Guides / progressive-disclosure docs a skill cites are a **separate slice**
  (a skill referencing an external guide by path; the loader discovers and
  surfaces it). Noted here because it shares the "additive, low-friction" spirit.

## Proof (when implemented)

1. `parseSkillMarkdown` on a real pi `SKILL.md` (name + description only) returns
   `ok: true` (today it returns `ok: false` with `CAPABILITY_LIST_EMPTY`).
2. `loadSkillsFromManifest` loads it at `maturity: "permissive"` with a warning
   naming the missing capabilities; a skill that declares capabilities loads at
   `complete` with no warnings.
3. The skill-contract conformance suite still passes (a complete manifest is still
   valid); a new case asserts a capability-less manifest is now valid.
4. A publish/package preflight rejects a `permissive` surface.

## Open questions for review

- The "serious run" heuristic: what triggers the host to surface maturity
  warnings — only a publish attempt, or also an operator flag / a REPL command?
- Should `theme` gain a `permissive` level (load a token-incomplete theme with a
  fallback + warning) or stay strict (reject incomplete)? Themes differ from
  skills — an incomplete theme renders wrong, a capability-less skill just runs
  ungated. Leaning: themes stay strict, skills go permissive.
- Where the maturity classifier lives when more surfaces adopt it — stays in
  `plugin-surface-loader`, or graduates to a small shared `extension-maturity`
  helper.
