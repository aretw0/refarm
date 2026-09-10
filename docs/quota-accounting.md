# What the quota has left, and how much of it was this node

`refarm budget quota` answers the question an operator actually asks — *how much
of my quota is left* — without pretending this node caused the spending it did
not do.

```bash
refarm budget quota
refarm budget quota --json
```

## Why the two numbers are never subtracted

The obvious report would be `not dispatched = consumed − dispatched`. It cannot
be computed, and each reason is a separate wall:

| Wall | Measured |
| --- | --- |
| **Units** | the provider meters *premium interactions*; the record counts tokens and requests |
| **Time** | the meters reset on a date, so an all-time dispatch count spans a different period |
| **Meter** | not every dispatch spends a metered meter — the model measured landed on an `unlimited` one |

So the report puts both figures side by side and **names the attribution between
them**. A reader shown two numbers and no attribution will subtract them; saying
*this is unattributed* is the only thing that stops it. There is a test whose
whole job is that `notDispatched` never appears in the output.

## The window is derived, and says so

The provider states a reset date and a monthly sku. The period is an inference
from those two, labelled `derived-from-reset` in every row.

A reset that is **not** a month boundary is refused rather than guessed — it
could be monthly-from-signup, weekly, or something this build has never seen, and
a guess produces a window that looks measured. With no window the count is
`null`, which is a different statement from the measured `0` an account with a
known window and no traffic gets.

## Which meter a dispatch spends

Measured 2026-08-18, after two cheaper answers failed:

- **The provider does not say.** A completion returns twelve response headers and
  none mention quota, limit, premium, usage or remaining.
- **A hardcoded table would age in silence** — the exact failure this surface
  exists to prevent.

What is left is this node's own measurement:

```
1. refarm credential quota --json      # read the meter
2. refarm ask "…"                      # dispatch once, on the account under test
3. refarm credential quota --json      # read it again — which meter moved?
```

Then declare the result **with its date**, in the node-tier config:

```json
{
  "modelMeters": [
    { "provider": "github-copilot", "model": "gpt-4o",
      "meter": "premium_interactions", "consumes": false, "measuredAt": "2026-08-18" }
  ]
}
```

An entry without `measuredAt` is **dropped, not trusted**. A fact nobody can
re-check is a fact nobody will.

## Two answers, and the third that is deliberately missing

| Attribution | When |
| --- | --- |
| `none` | every model dispatched was measured not to touch this meter |
| `unknown` | any model was never measured, **or** a measured model does spend it |

A **number** is missing on purpose. This provider publishes per-model multipliers
for premium interactions, so knowing a model spends the meter does not say how
much, and counting one dispatch as one interaction would be a rate this node
invented.

One unmeasured model poisons the claim for the whole account — `none` would
assert something about traffic nobody looked at.

**Silence is not the same as unclassifiable traffic.** An account that dispatched
requests whose model could not be read reports `unknown`, never `none`: only "I
sent nothing" supports a claim that a meter went untouched.
