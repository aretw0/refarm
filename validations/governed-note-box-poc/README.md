# Governed Note Box PoC

This validation is a small, synthetic, local-only proof of a minimum governed
note workflow.

It answers one question:

> Can a local note workflow preserve metadata, create lab and publication
> snapshots, and require human review before publish?

## Scope

The PoC uses only fictitious notes. It does not read a real vault, use work
drafts, call external services, use personal data, use institutional data, or
read secrets.

## What It Demonstrates

- A local intake snapshot preserves note body, tags, links, status, and dates.
- A metadata index keeps stable IDs, sorted tags, sorted links, and body hashes.
- A lab snapshot exposes graph and metrics without owning notebook UX.
- A publication snapshot excludes draft notes.
- A preflight report requires human review before publication.
- A risk and standards matrix records workflow controls, publication risks,
  gaps, and no conformance claim.
- A consumer evidence report records which manifest selectors downstream labs
  and vault-local tools can use without claiming real vault integration.
- A limits report records non-claims, adoption risks, and promotion criteria.
- JSON artifacts and a Markdown review report are generated deterministically.
- A `refarm.task-artifacts.v1` manifest lists generated outputs with media
  types, SHA-256 hashes, review state, provenance, and consumer labels.

## What It Does Not Demonstrate

- Real Obsidian, Astro, Marimo, or vault-specific UX.
- Complete publication workflow.
- Editorial rules, note schemas, or PARA conventions.
- Integration with `vault-seed` or any work mirror.

## Run

From the repository root:

```bash
pnpm run governed-note-box:poc:test
```

To regenerate the expected synthetic artifacts:

```bash
pnpm run governed-note-box:poc
```

## Success Criteria

- Every note has metadata and a body hash.
- Draft notes are excluded from the publication snapshot.
- Lab metrics are generated without external services.
- Publication preflight requires human review.
- `fixtures/expected/task-artifacts.json` describes all generated outputs.

## Artifacts

Expected artifacts live in `fixtures/expected/`:

- `intake-snapshot.json`
- `metadata-index.json`
- `lab-snapshot.json`
- `publication-snapshot.json`
- `publication-preflight.json`
- `scorecard.json`
- `risk-and-standards-matrix.json`
- `consumer-evidence.json`
- `scenario.md`
- `annex.md`
- `limits.md`
- `human-review.md`
- `task-artifacts.json`

## Next Steps

- Let a downstream Lab consume `task-artifacts.json` via
  `@refarm.dev/artifact-contract-v1` selectors.
- Keep note schemas, publication outbox, and vault-local commands in the
  consumer project.
- Promote only repeated metadata, provenance, and preflight needs back into
  Refarm contracts.
