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

## The workspace announces, the node grants

A workspace may carry its own baseline — what working on it is expected to cost —
in **its** `.refarm/config.json`, under the same key:

```json
{ "workspaceAllowances": { "refarm": { "maxRequestsPerMonth": 200 } } }
```

It travels with the repository. It is a **need stated**, never a grant held —
`docs/CONFIG_TIERS.md`'s rule, and one asymmetry enforces it:

| Workspace announces | Node granted | Binds | Why |
| --- | --- | --- | --- |
| 100 | 400 | **100** | tightening takes nothing from anyone |
| 800 | 400 | **400** | a cloned repo must not widen your spend |
| 100 | *nothing* | **100** | asking to be bounded is not an escalation |
| *nothing* | 400 | **400** | — |

Equal values report the **node** as the binding side: nothing changed hands, and
naming the workspace would send you to raise the wrong ceiling.

This gives you the three postures without a mode switch:

- **keep your own** — declare the grant; announcements can only tighten it
- **canonise** — write the announcement into your node's grant (a hand edit today)
- **honour** — do nothing; a tightening announcement binds on its own

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
