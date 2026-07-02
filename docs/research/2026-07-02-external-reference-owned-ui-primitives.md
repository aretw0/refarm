# Research: external reference — owned UI primitives (liquid-glass, humation) (2026-07-02)

> Reference/influence note. Lesson sources for *owned, deterministic, first-class* UI primitives in the
> design system — not dependency decisions, not product copy. Flagged by the vault-seed consumer alongside
> the UI-composition-guardrails research, but they belong to a **different front** (DS assets, long-term),
> **not** screen verification. Placed here so the influence is not folded into the design-lint discourse.

## Why these belong together

Both show the posture the DS/homestead already wants: a UI capability that is **owned** (copy-paste, zero
external service), **deterministic**, **offline**, and **accessible/performant by construction** — the
opposite of reaching for an AI/SaaS widget. This is a long-term DS-asset decision, downstream of the DS
bootstrap ([design-system-bootstrap-discussion.md](./design-system-bootstrap-discussion.md)), not
immediate help.

## `samasante/liquid-glass`

Apple-style "Liquid Glass" as a React component: glassmorphism via SVG `feDisplacementMap` refracting the
**live DOM** (text stays selectable, links clickable — accessible by construction), 3-pass chromatic
aberration, optional WebGL for video/canvas, 60fps imperative motion (no React re-renders), explicit
Safari/Firefox handling, zero runtime deps, "own-them" copy-paste components.

- **Lesson for the DS:** a premium effect can be first-class *and* accessible — refract the real DOM, do
  not snapshot. A candidate owned premium-surface primitive (video controls, overlays), not a dependency.
- Its design *principle* ("a tell is low effort, not a banned effect") is used separately by the UI
  composition guardrail; here it is the asset that proves the principle.

## `humation-labs/humation`

A hand-drawn kawaii **avatar engine**: deterministic (seed → same SVG via FNV-1a hashing), 86 modular
parts across slots, CSS-variable recolor, framework-agnostic SVG, **no AI, no API calls, offline**.

- **Lesson for the DS:** owned, deterministic, offline assets so downstream never reaches for an AI-avatar
  service — same seed → same output (auditable), no network as a risk vector. A candidate owned
  identity/avatar primitive.

## Boundary

Both are external projects, studied as influence, not adopted as dependencies. They inform *whether/what*
owned UI primitives the DS should carry — a long-term asset decision, separate from the immediate
design-verification front ([2026-07-02-ui-composition-guardrails.md](./2026-07-02-ui-composition-guardrails.md)).
