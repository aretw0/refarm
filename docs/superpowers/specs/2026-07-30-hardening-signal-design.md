# The hardening signal — the suite tells you where to grow, not just whether you broke it

Date: 2026-07-30
Status: First slice implemented (2026-08-01) — `@refarm.dev/hardening`, `refarm hardening`
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — substrate

## What forced this

The CLI refusal harness was about to be added, and it will almost certainly go red on several
commands. The operator turned that from a problem into the point:

> *"gosto da ideia de tornar essas deficiências como parte de um sinal da nossa suite para nos
> mostrar onde endurecer … como queremos crescer bastante, crescer direito, com os sinais que mais
> nos ajudam a postos, sempre saberíamos onde melhorar a stack."*

They are right, and the reframing is worth more than the harness that prompted it.

## What already exists (measured, 2026-07-30)

**21 exported `*ConformanceResult` types across 22 packages**, and seven exported
`run*Conformance` entry points — asset-resolver, ds-theme, host-renderer, dispatch-result,
event-bus, provenance, operator-channel, and more with result shapes but no runner.

Every block already knows how to check itself. **Nothing ever asks all of them at once.** The
capability is built and uncollected — the same shape as the day's other findings, one level up.

## H1 — A gate and a signal are different things, and conflating them is why demanding checks never get added

A **gate** must be green for work to proceed. A **signal** reports where you are and is allowed to
be non-zero.

A check that must be green can only be introduced when everything already satisfies it — which means
it can never be introduced into a real codebase. That is the whole reason demanding checks get
written, run once, and deleted.

So the harness produces both:

- **the signal** — the current list of things that do not yet satisfy a contract, visible and
  counted;
- **the gate** — that list must not *grow*.

## H2 — The ratchet: a baseline that can only shrink

Known non-conformances are recorded as a baseline. The gate compares against it:

- a new failure not in the baseline ⇒ **red**, because that is a regression;
- a baseline entry that now passes ⇒ it must be **removed** from the baseline, so progress is
  permanent and cannot silently un-happen;
- the baseline shrinking is the only direction that requires no ceremony.

**Adding an entry to the baseline must be an explicit, reviewable act** — a deliberate edit, never
an automatic capture. Auto-capture turns the baseline into a mute button, and a mute button is worse
than no check because it looks like coverage.

## H3 — "Not applicable" is not "not done"

A signal that lumps *this contract does not apply here* together with *this has not been hardened
yet* is noise, and noise gets ignored, and an ignored signal is worse than none.

This is the distinction this repo keeps rediscovering — `down` vs `unknown` on a probe, "the tailnet
answered nobody" vs "I could not ask", a refused declaration vs an absent one. Its sixth appearance
should settle it as a house rule rather than a recurring surprise: **whenever an answer can be
absent, say which kind of absent.**

So an entry carries its kind: conformant, not-yet-hardened (with a pointer to what would fix it), or
not-applicable (with the reason it does not apply).

## H4 — A signal nobody reads is a log

R3 of the operation-consent design says a record without an undo is a log, and a log does not give
you sovereignty. The same applies here, pointed at ourselves: a hardening count buried in CI output
that nobody opens is not a signal.

It has to be answerable on demand — one command, human-readable and `--json`, saying what is
hardened, what is not, and what the next most valuable thing to fix is. If the operator cannot ask
*"where should I harden next?"* and get an answer, this document has produced a report format, not a
signal.

## H5 — Aggregate what exists before writing anything new

The 21 conformance results are the substance. The work is a collector that runs them, normalises
their shapes, and reports — plus the CLI refusal harness as one more contributor, not as the centre.

Writing a new conformance framework while 21 uncollected ones sit in the repo would repeat the
mistake this document exists to name.

## First slice

The collector over the suites that already have runnable entry points, plus the CLI refusal harness,
plus the baseline and its ratchet. `refarm health` is the natural home for the question — it already
audits structure, build alignment and resolution — but the signal must be its own answer, not a line
buried in an existing report.

## Not in this slice

Scoring or weighting the entries. "The next most valuable thing to fix" is H4's promise, and the
honest first version orders by contract and package rather than pretending to a priority model
nobody has calibrated.

## What the first slice found (2026-08-01)

`@refarm.dev/hardening` + `refarm hardening`. On this repo, today:

> **26 conformance suites, 24 conformant (298 checks); 0 not yet hardened; 2 not applicable.**

Three things the design doc could not have known, and one it got wrong in a useful direction:

- **The inventory was undercounted, twice over.** This document measured "seven exported
  `run*Conformance` entry points" on 2026-07-30; the hand-measured inventory the implementation was
  commissioned against named 15. Discovery finds **26**. That is the H5 point sharpened: the
  capability was even more built, and even more uncollected, than the day's measurement showed.
- **`grep -r` silently skips a file containing a NUL byte**, and
  `packages/artifact-contract-v1/src/conformance.ts` has one (line 88, inside a string literal). Its
  runner was invisible to every grep-driven audit of this repo — including the ones that produced
  the counts above. The collector reads files itself for exactly this reason.
- **"Result shapes but no runner" is now an empty set.** All 23 declared `*ConformanceResult` types
  have a runner in their own package. The state is still modelled and still tested (a shape with no
  entry point reports `not-applicable`, never a failure), because it will recur — but the gap this
  document named has since closed on its own.
- **The vendored copy is real and is byte-identical.** `packages/farm-client/vendor/`
  `prompt-contract-v1.mjs` and `packages/prompt-contract-v1` export the same
  `runOperatorChannelConformance`; the dedup is justified by comparing the runners' source, not by
  the `vendor/` path, so a copy that ever DRIFTS stops being merged and the signal grows by one.

The first debt in `hardening-baseline.json`,
`@refarm.dev/homestead#runHostRendererConformance`, closed on 2026-08-01. Homestead now exports a
reference descriptor factory and the collector drives it once for each declared renderer kind:
web, TUI, and headless. The baseline is empty — the valid destination of a shrinking ratchet.
