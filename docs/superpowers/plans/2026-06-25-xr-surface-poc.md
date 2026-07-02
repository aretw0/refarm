# Plan: XR Surface POC

> Spec: `specs/features/2026-06-25-xr-surface-poc.md`.
> Goal: evaluate XR as a consumer surface over Refarm without making it a core dependency.

## Task 1 - Pick data envelope

- Choose one Refarm state shape to visualize: package graph, generated vault map, or action queue.
- Write a small JSON fixture.
- Gate: fixture is documented and independent of renderer choice.

## Task 2 - Capability probe

- Implement a browser-side probe for WebXR presence, secure-context availability, and session
  support.
- Gate: probe reports `supported`, `unsupported`, or `blocked` without throwing.

## Task 3 - 2D fallback

- Render the same fixture through `homestead`/`ds`.
- Gate: fallback is the default path in ordinary desktop browsers.

## Task 4 - XR scene

- Build the smallest A-Frame scene that consumes the fixture.
- Keep A-Frame/three.js imports inside the POC directory.
- Gate: scene renders in normal browser preview and exposes an XR entry path when available.

## Task 5 - Graduation decision

- Green: write a proper feature spec for an XR surface package.
- Red: record blocker and keep XR as frontier research.
- Either way: do not block convergence items 4, 5, 6, 7, 8, 9, or 10.
