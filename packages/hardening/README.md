# @refarm.dev/hardening

**The hardening signal** — the suite tells you where to grow, not just whether you broke it.

Design: [`docs/superpowers/specs/2026-07-30-hardening-signal-design.md`](../../docs/superpowers/specs/2026-07-30-hardening-signal-design.md).
Answered on demand by `refarm hardening`.

Every contract package in this repo already knows how to check itself. Nothing ever asked all of
them at once. This is the asking.

```bash
refarm hardening          # where should I harden next?
refarm hardening --json   # the same answer, for an agent
refarm hardening --gate   # the ratchet: red when the signal grows
```

## The three states (H3)

An entry is never merely "not green". It says **which kind** of answer it is:

| state              | meaning                                        | carries                             |
| ------------------ | ---------------------------------------------- | ----------------------------------- |
| `conformant`       | the suite ran and every check passed            | the check count                     |
| `not-yet-hardened` | it failed, or nothing here could run it         | `fix` — what would close it         |
| `not-applicable`   | the contract does not apply at this entry point | `reason` — why it does not apply    |

`not-applicable` is not a place to hide work: an entry cannot reach that state without a reason,
and the ratchet deletes a baseline entry that becomes one.

## Discovery, and why it is not a list

`discoverConformanceSuites()` scans the workspace's own packages for `export function
run*Conformance` declarations. It is deliberately not a list: the hand-measured inventory this
package was commissioned against named 15 entry points, and the scan finds 26. Two reasons the hand
count came up short, both worth knowing:

- `grep -r` **silently skips a file containing a NUL byte**, and
  `packages/artifact-contract-v1/src/conformance.ts` has one — so `runArtifactV1Conformance` was
  invisible to every grep-driven audit of this repo. This package reads files itself.
- a suite is not always in a file called `conformance.ts` (`ds/src/theme-conformance.ts`,
  `homestead/src/sdk/host-renderer.ts`, `prompt-contract-v1/src/index.ts`).

Which suites exist is discovered. Which **subject** drives a suite is resolved by convention (a
single zero-argument `createInMemory*` factory on the package root) and, where the convention cannot
answer, by an explicit binding in [`src/subjects.ts`](src/subjects.ts) that carries its reason. A
suite with no binding is still discovered and still reported — as `not-yet-hardened`, with "bind a
subject" as its fix. The failure mode of a hand-maintained list is *silence*; nothing here can be
silent about a suite that exists.

## The ratchet (H1, H2)

The **signal** is allowed to be non-zero. The **gate** is that it must not grow.

`hardening-baseline.json` at the workspace root records known, accepted debts. `refarm hardening
--gate` is red when:

- a suite that is not in the baseline is not hardened (growth);
- a baselined suite now passes and its entry was not deleted (progress must be permanent);
- a baseline entry names nothing, has become not-applicable, or carries no note.

**Nothing writes the baseline.** This package has no write path at all — `src/no-auto-capture.test.ts`
asserts it from three directions, and the command declares no option that would capture. Adding an
entry is a hand edit in a diff someone reads, because a baseline a machine can append to is a mute
button that looks like coverage.
