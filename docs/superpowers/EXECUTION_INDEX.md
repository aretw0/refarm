# Execution index: which commits executed which plan

A slice in this repo produces three things. Two of them are committed —
`docs/superpowers/specs/` (the design) and `docs/superpowers/plans/` (the tasks)
— and the third, the execution record, was written into a gitignored
`.superpowers/` and lost to everyone but the machine that ran it (ISS-070).

**This file is the part of that record worth keeping, and it is the only part.**

## What was there, measured 2026-08-11

```
241 .md    2.2 MB   briefs, task reports, progress notes
103 .diff  33.9 MB  review-<sha>..<sha>.diff
```

The diffs are 94% of the bulk and none of the value. Each is a **derived
observation** in the exact sense AGENTS.md section 0 uses the phrase — the
repository already holds every byte.

Verified rather than assumed, 2026-08-11:

- All **119 SHAs** referenced by those filenames resolve to live commits here.
- A random sample of **20 review packages** regenerates **byte-for-byte
  identical**, including whitespace, with `git diff -U10`.

The `-U10` matters and is why this was measured instead of asserted: a plain
`git diff` produces a *smaller* file (5,132 bytes against the saved 6,722 for one
sampled range) because the packages were written with ten lines of context. A
claim of "regenerable" that reproduces different bytes is not a claim, it is a
guess — the first check here failed for exactly that reason and the flag is the
correction.

The briefs and reports are not committed either, and deliberately: the design is
already in the spec, the tasks are already in the plan, the defects found are
already in `.project/issues.json`, and the decisions are already in
`docs/decision-log.md`. Committing 241 more files would be dumping session
scrollback beside four records that already hold what it says.

**What was NOT recoverable from anywhere is the SHA pairs.** They are the link
between a committed plan and the commits that executed it — `git log` by date
gets close and is not the same thing. That link is below.

## Regenerating any review diff

A saved package is three parts, and each has its command:

```bash
git log --oneline <from>..<to>   # the "## Commits" block
git diff --stat  <from>..<to>    # the "## Files changed" block
git diff -U10    <from>..<to>    # the body, byte-for-byte
```

## The index

| Slice | Design | Plan | Commit range | Reviews |
| --- | --- | --- | --- | --- |
| `2026-07-29-operator-channel-over-the-mesh-design` | [spec](specs/2026-07-29-operator-channel-over-the-mesh-design.md) | — | `a69c35f5..2697502d` | 2 |
| `2026-08-03-budget-laboratory` | [spec](specs/2026-08-03-budget-laboratory-design.md) | [plan](plans/2026-08-03-budget-laboratory.md) | `5299b25a..e44b83c0` | 22 |
| `2026-08-05-the-cockpit-refarm-context` | — | [plan](plans/2026-08-05-the-cockpit-refarm-context.md) | `60afc97e..037c3ff5` | 9 |
| `2026-08-05-workspace-attribution-at-origin` | [spec](specs/2026-08-05-workspace-attribution-at-origin-design.md) | [plan](plans/2026-08-05-workspace-attribution-at-origin.md) | `a2937269..31caed4d` | 9 |
| `2026-08-06-a-workspace-is-not-a-node` | [spec](specs/2026-08-06-a-workspace-is-not-a-node-design.md) | [plan](plans/2026-08-06-a-workspace-is-not-a-node.md) | `6685059b..b44351b6` | 6 |
| `2026-08-06-the-contract-reaches-every-consumer` | — | [plan](plans/2026-08-06-the-contract-reaches-every-consumer.md) | `0ce92d10..77a365d5` | 6 |
| `2026-08-06-the-guest-can-tell` | — | [plan](plans/2026-08-06-the-guest-can-tell.md) | `1a17fbd4..101cec1a` | 7 |
| `2026-08-06-the-node-answers-for-itself` | — | [plan](plans/2026-08-06-the-node-answers-for-itself.md) | `75b760a1..e7daa45c` | 5 |
| `2026-08-06-the-record-reader-goes-blind` | — | [plan](plans/2026-08-06-the-record-reader-goes-blind.md) | `a9390706..f5c3d483` | 6 |
| `2026-08-06-the-sandbox-node` | — | [plan](plans/2026-08-06-the-sandbox-node.md) | `f933a7f7..5fb83cb6` | 15 |
| `2026-08-06-two-halves-one-node` | — | [plan](plans/2026-08-06-two-halves-one-node.md) | `ae5de5ac..03eecd56` | 1 |
| `2026-08-07-no-resolver-defaults-to-the-os` | — | [plan](plans/2026-08-07-no-resolver-defaults-to-the-os.md) | — | 0 |
| `2026-08-07-who-owns-this-work` | — | [plan](plans/2026-08-07-who-owns-this-work.md) | — | 0 |
| `2026-08-08-the-ledger-is-alive` | [spec](specs/2026-08-08-the-ledger-is-alive-design.md) | [plan](plans/2026-08-08-the-ledger-is-alive.md) | `ee8d62bb..9fde120c` | 14 |
| `2026-08-08-what-did-this-cost` | — | [plan](plans/2026-08-08-what-did-this-cost.md) | `9888ddc5..817bcd08` | 1 |

Two slices carry no range: `2026-08-07-no-resolver-defaults-to-the-os` and
`2026-08-07-who-owns-this-work` produced no review diffs at all. That is not
missing data — it is the record that those two were never reviewed as a range,
which is consistent with what their own plans say (the first has Task 1 done and
Task 2+ unstarted; the second was re-aimed mid-flight after its Task 1 audit
found the wrong work selected). Both facts survive here rather than in a
directory nobody else can read.

## What this means for `.superpowers/`

It stays gitignored, and now it is also **disposable**: everything durable about
it is either committed elsewhere or reconstructable from the ranges above. On the
node this index was built from it was 37 MB, which
[`docs/local-disk-hygiene.md`](../local-disk-hygiene.md) is the right home for
deciding about — it is the operator's local disk, not the repository's problem.
