# What a workspace may spend in a month

```json
{
  "workspaceAllowances": {
    "refarm": { "maxRequestsPerMonth": 400 }
  }
}
```

Declared in the **node-tier** config. `refarm ask` refuses before dispatching
once the workspace has spent it:

```
refarm ask: this node has dispatched 8 of the 2 request(s) allowed for "rcdc5"
this month. Raise the allowance, wait for the month to turn, or bind the
workspace to another account. This bounds what THIS NODE sends — other clients
spend the same seat.
```

## Why not a ceiling on the budget fold

`resolveBudget` bounds **one dispatch** — its ceilings ride in that dispatch's
payload. That is the wrong shape for a subscription, and the difference is not
academic: measured 2026-08-18, an operator's shared seat went from 1706 premium
interactions remaining to zero while every token ceiling on the node stayed
untouched. Five hundred dispatches of one request each never approach a per-run
cap.

A subscription is metered per request across a period. So is this.

## What it cannot do

It does **not** reserve a share of the provider's meter. Other clients — another
editor, another machine, a browser tab — spend the same seat, and this node can
neither see nor bound them. It bounds what **this node** dispatches for one
workspace, which is the only thing it is in a position to promise.

## Three outcomes

| State | Meaning | Dispatch |
| --- | --- | --- |
| `unbounded` | nobody declared a limit for this workspace | permitted |
| `within` | under the allowance | permitted |
| `exceeded` | spent | **refused**, exit 1 |
| `cannot-check` | the record could not be read | permitted, **and said out loud** |

`cannot-check` is the load-bearing one. Refusing work because the node cannot
count would make it unusable exactly when its runtime is down; permitting in
silence would make the allowance a fiction. Permitting out loud is neither — and
it makes the allowance a **conditional** promise, which is tracked in ISS-152.

## Two things that will surprise you

**It sums across accounts.** The allowance bounds the *workspace*. Counting per
account would let one workspace spend its full cap against every seat the node
holds, which is the opposite of protecting them.

**It applies to the workspace the SESSION declares, not the directory you are
standing in.** An active session carries a declared workspace that overrides the
cwd seed — the four-degree ladder `refarm ask` documents (explicit flag →
inherited session declaration → cwd seed → nothing). An allowance declared on
the wrong name refuses nothing and looks broken. `refarm budget quota` shows
which workspace actually spent each seat.

## The window is a month, and says so

A UTC calendar month, because a month is what the counter counts. `refarm budget
quota` reports against the **provider's** own stated reset date instead; for
github-copilot the two coincide, and where they would not, the report shows the
provider's window so the difference is visible rather than assumed.
