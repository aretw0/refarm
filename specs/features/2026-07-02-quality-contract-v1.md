# Spec: Quality Contract v1 (`quality:v1`) — Declared Quality/Lint Intentions

**Status:** DESIGN — brainstormed with the vault-seed consumer; unifies an already-proven text-quality
declaration pattern (assimilated downstream) plus the UI-composition guardrail research into one primitive
**Authors:** Arthur Silva, Claude
**Date:** 2026-07-02
**Related:** [`2026-06-30-records-contract-v1.md`](./2026-06-30-records-contract-v1.md) (vocabulary-is-data
sibling), [`../../docs/research/2026-07-02-ui-composition-guardrails.md`](../../docs/research/2026-07-02-ui-composition-guardrails.md)
(the UI tier), `packages/skill-contract-v1` (skills axis), `packages/plugin-manifest` + the
`extension-sandbox-poc` (the WASM checker host), `packages/toolbox` (white-label)

---

## Context & Motivation

Quality checks are scattered. A downstream consumer already runs a **text-quality** evaluator that is, in
effect, a small declaration primitive: rules in a `quality-rules.json` (`riskPatterns` of
`{id, severity, description, regex}`), composable **profiles**, and a `score_text(text, config) → findings`
engine emitting `{severity, rule, message, locus}`. The UI-composition guardrail research describes the
*same* shape for a different domain (rules + severity + findings + profiles, over a rendered DOM instead of
text). And a typical consumer accretes a dozen more ad-hoc linters (diagrams, theme, structure, prose).

They are all the same idea with a different **matcher**. There is no versioned contract that lets each
consumer *declare its quality intentions* — whatever it wants to lint — over a shared envelope. `quality:v1`
is that contract: a neutral rule/finding/profile envelope with a **pluggable, per-domain checker**, so the
text evaluator, the UI guardrail, and future linters converge instead of each re-deriving the wheel.

This is not a fixed rule set or a taxonomy. The rule *catalogs* (text tells, design tells) and the per-domain
*matchers* are data/implementations; `quality:v1` owns only the neutral envelope and its forward-compat
rules — exactly as `records:v1` owns the record envelope but not the vocabulary.

### Confirmed decisions

| Decision | Choice | Reason |
|---|---|---|
| Form | `quality:v1` capability contract (types + conformance + a checker interface) | Refarm's idiom (records/credentials/enrichment/source all follow it). |
| Matcher | The rule's `check` and the finding's `locus` are **opaque data** the checker interprets | "Matcher is data" — text (regex), UI (DOM assert), future domains, with no contract change. |
| Checkers | A `QualityChecker` interface; reference checkers per domain; implementable **native (in-process) or as a sandboxed WASM plugin** | Existing suites stay native; new/untrusted checkers run sandboxed. Both conform; the host treats them uniformly. |
| Declaration | Each consumer declares a **profile** (rules, severities, composition) in config | "Each declares its intentions." The framework + generic catalogs are shared; a consumer's profile is its own. |
| Evolution | `version` on the manifest; open `severity` strings; preserve-unknown | Forward-safe; new severities/rules never break older readers. |

---

## 1. Contract interface (`packages/quality-contract-v1/src/types.ts`)

```ts
export const QUALITY_CAPABILITY = "quality:v1" as const;

/** A rule. The ENVELOPE is generic; `check` is data the CHECKER interprets
 *  (a regex for text, a selector+assertion for DOM, …). Matcher-is-data. */
export interface QualityRule {
  id: string;
  severity: string;                 // open: "fail" | "warn" | "info" | <future>
  description: string;
  category?: string;                // "ai-tell" | "a11y" | "structure" | …
  check: { type: string; [param: string]: unknown };   // opaque to the contract
}

/** Profiles compose (a base profile → a stricter one), as effective-config resolution already does. */
export interface QualityProfile { name: string; extends?: string; rules: QualityRule[]; }

/** Finding with a GENERIC locus (line/snippet for text; selector/element for UI). */
export interface Finding { severity: string; ruleId: string; message: string; locus?: Record<string, unknown>; }
export interface QualityReport { findings: Finding[]; counts: Record<string, number>; metrics?: Record<string, unknown>; }

/** The extension point. `subject` is domain-specific (a string for text, a serialized DOM for UI);
 *  the checker declares its domain. Implementable in-process or behind a WASM plugin. */
export interface QualityChecker {
  readonly checkerId: string;
  readonly domain: string;          // "text" | "ui" | …
  check(subject: unknown, profile: QualityProfile): Finding[] | Promise<Finding[]>;
}
```

`runQualityV1Conformance(checker)` asserts: findings carry `ruleId` + `severity`; unknown severities do not
throw (forward-safe); profile composition (`extends`) resolves; a deterministic subject yields deterministic
findings.

---

## 2. Reference checkers + the WASM plugin surface

A checker can be **native** (in-process) or a **sandboxed WASM plugin**. Both satisfy `QualityChecker`; the
host aggregates their findings into one `QualityReport`.

### 2.1 WASM checker surface (WIT / Component Model)

```wit
package refarm:quality@0.1.0;

interface checker {
  variant subject { text(string), dom(string) }   // dom = tree serialized by the HOST
  record rule    { id: string, severity: string, description: string,
                   category: option<string>, check: string }   // check = opaque JSON
  record profile { name: string, rules: list<rule> }
  record finding { severity: string, rule-id: string, message: string, locus: option<string> }
  check: func(subject: subject, profile: profile) -> list<finding>;
}

world quality-checker {
  export checker;
  // NO wasi:filesystem / wasi:sockets / env imports — pure compute
}
```

The `world` imports nothing: a checker is **pure compute**. It sees only the `subject` the host hands it and
returns findings — so even an untrusted checker from a different author cannot exfiltrate or damage. The host
does anything that needs capability (render a page, serialize its DOM, read text); the plugin does only the
analysis. This is the capability model at its cleanest — useful code, minimal trust.

### 2.2 Reference checkers (data + implementations)

- **`text-tells`** (domain `text`): writing tells as `check.type: "regex"` rules (chatbot artifacts, vague
  attribution, generic conclusions, self-promotion, …). The existing native text evaluator conforms by
  reading a `quality:v1` profile and emitting `quality:v1` findings — no rewrite.
- **`design-tells`** (domain `ui`): a11y + composition rules over the serialized DOM (contrast per rendered
  pair, overflow, heading hierarchy, fluid type; plus the heuristic "AI-made" tell tier). The UI guardrail
  research is this checker's rule catalog.

Rule catalogs are **data** and distributable; a consumer adds its own rules/profiles without a contract
change.

---

## 3. The extensibility demonstration (a white-label CLI over the primitive)

`quality:v1` composes with the existing plugin/skill/agent blocks into a reproducible showcase of **secure
extensibility** — a white-label CLI (refarm underneath, via `toolbox`) that installs an agent, installs (or
authors) extensions, and does real work under a quality gate:

```
install    a white-label CLI (refarm underneath)
agent      install a coding agent (lean, over the public agent contracts)
extend     install sandboxed WASM plugins (e.g. the checker plugins) from different authors;
           and install OR author a skill (skill-contract) for a specific need
work       the CLI does a DETERMINISTIC scaffold (reproducible, no model tokens);
           the agent spends real tokens only on genuine authoring work (e.g. a new plugin)
gate       the checker plugins evaluate the output (maker/checker loop) until clean
```

Design principles this encodes:

- **Determinism first, tokens where they earn it.** The reproducible base is scaffolded deterministically;
  model tokens are reserved for genuine creative work (authoring a new capability). Efficient and auditable
  AI use, not gratuitous — a defensible posture for regulated contexts.
- **Extensibility on every axis.** Sandboxed plugins (consume *and* the agent authors one), skills (install
  *and* create), a deterministic scaffold — not a fixed toolset.
- **Maker/checker.** The agent makes; the checker plugins are the gate; the loop corrects until clean.

The demonstration is generic (a template, a skill, a service); concrete downstream compositions and personas
live in the downstream consumers, not here.

---

## 4. Forward compatibility

- **Matcher-is-data.** `check`/`locus` are opaque; new domains ship as checker implementations + rule data,
  never as contract edits.
- **Open severities.** `severity` is an open string; new severities do not break older readers.
- **Preserve-unknown.** Readers round-trip unknown fields on rule/finding.
- **Native ↔ WASM parity.** The same `QualityChecker` is satisfied in-process or sandboxed; migration is
  gradual, never forced.

## 5. Boundaries, ownership, sequencing, testing

- **Ownership.** Refarm owns `quality:v1`, the plugin host, and the reference checker plugins (distributed).
  Downstream consumers own their **profiles** (their declared intentions) and run checkers against their own
  subjects; they do not own the framework.
- **Distribute-first sequencing.** The blocks (`quality:v1`, the checker plugins, the demo substrate) must be
  built **and distributed** before downstream consumers compose them, so downstream work is genuine
  composition over real, installed software — not a workaround. This puts `quality:v1` in the near-term build
  lane, alongside/just after the first release.
- **Testing.** `quality:v1` conformance; per-checker rule→finding tests; a **sandbox test** proving a WASM
  checker cannot reach fs/network (the security claim); a downstream consumer proof (a native checker
  conforming); a smoke of the demonstration flow.

## Non-Goals

- No fixed rule taxonomy, editorial policy, or domain rule sets in the contract — catalogs are data.
- No rendering/IO in the checker surface — the host provides the subject; the checker is pure.
- No orchestration engine — `quality:v1` is a declaration + finding envelope, not a scheduler; a maker/checker
  loop composes it with the agent/host, it is not part of the contract.
