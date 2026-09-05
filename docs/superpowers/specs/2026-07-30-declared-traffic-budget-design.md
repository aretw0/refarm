# Declared traffic budget — cache and rate are policy, and policy is declared

Date: 2026-07-30
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — substrate
Extends: E5 of [`2026-07-30-phone-initiated-enrolment-design.md`](2026-07-30-phone-initiated-enrolment-design.md)

## What forced this

The operator, watching the mesh-distribution work land:

> *"cuidado com possíveis footguns onde uma política de cache devidamente aplicada pode resolver, se
> tendemos a muito trânsito operacional ao mesmo tempo é preciso ter bastante soberania sobre ele,
> também pode declaração nossa e que se for boa prática pode estar no nível de sdk com dx acessível."*

E5 already said "honest polling — backoff, not a tight loop, and a **stated** interval". It meant
*stated* as in written down. This document upgrades it to *declared* in this repo's sense: a
vocabulary the operator writes and adapters consume, rather than a number each call site picks.

## What is actually happening today (measured, 2026-07-30)

Three self-inflicted traffic patterns, none of them declared anywhere:

1. **The kit updater fetches `manifest.json` unconditionally, every run.** The payload layer is
   already excellent — `planUpdate` downloads only changed files and verifies sha256 per file, which
   is content addressing and beats ETags for a file set. But `refarm web serve` sends **no cache
   headers at all**: no `ETag`, no `Cache-Control`, no `Last-Modified`, no conditional `304`. So the
   control fetch — the one that happens on every update, on every device, forever — is the one with
   no policy.
2. **The auth policy is polled every 2 seconds** by the daemon's hot reload. Cheap in isolation (a
   local SHA-256), and correctly chosen over inotify because the writer renames. But the interval is
   a constant in one file.
3. **Tailnet discovery spawns `tailscale status --json` per query**, deliberately uncached — a
   choice this repo argued for on purpose, so a stale list can never be offered. It has no floor,
   so repeated "Discover again" means repeated subprocess spawns.

The pattern is the day's recurring one in its fourth costume: **good behaviour that lives at a call
site instead of in a block.** Nothing here is wrong. Nothing here is inheritable either.

## T1 — "Deliberately live" must be declarable, or correct code looks like an omission

The trap in any caching vocabulary is that it can only express *caching*. Then case 3 above — a
query that must never be cached, for a reason we defended in writing — is indistinguishable from
someone who forgot to add a TTL.

This is exactly [O1](2026-07-30-open-by-declaration-surfaces-design.md)'s lesson repeating in a new
domain: refusing to lie leaves you with nothing to say. `gate: "none"` had to exist so that
deliberate openness could be told apart from an oversight. A traffic vocabulary needs the same
escape hatch: **`live` is a declaration, not an absence.**

So the minimum vocabulary is three things, not one:

- **a freshness window** — how stale an answer may be before it must be fetched again;
- **a floor between repeats** — the smallest interval two identical requests may be separated by,
  which is what protects a peer from a retry loop and us from a "Discover again" held down;
- **`live`** — an explicit statement that this answer is never reused, with the reason attached.

## T2 — The default is honest; the deviation is declared

An SDK primitive that must be *opted into* protects nothing, because the call site that forgets the
policy is the one that needed it. So the helper adapters consume should carry a sane default —
conditional requests when the protocol supports them, a floor on repeats — and require a
declaration only to *deviate*, including to declare `live`.

This mirrors how `surfaces` already works: undeclared means loopback, the safe thing. Undeclared
traffic should mean the polite thing.

## T3 — Do not build a DSL

The systemd/s6 lesson recorded in the connections design applies unchanged: converge the vocabulary,
not into one grand configuration language. Three knobs, named the same way everywhere, consumed
through one SDK helper. If a fourth knob is needed later it can be added; a framework built for
knobs that do not exist yet is how this becomes a burden instead of a floor.

Accessible DX means the common case is one line and the uncommon case is possible — not that every
call site gains a configuration object.

## First slice, when taken

The concrete gap worth closing first is the only one that costs real bandwidth: **`manifest.json`
served with an `ETag`, and `farm-update` sending `If-None-Match`.** It is small, it is measurable,
and it is the honest-citizen behaviour E5 asks for — pointed at our own mesh, where the peer being
spared is another of the operator's devices.

The other two consumers (the 2s poll, the deliberately-live discovery) join when the vocabulary
exists. Case 3 is the important one to migrate, because it is the one that proves `live` is a
declaration rather than a gap.
