# Canonical and extended flows — what refarm does when it knows nothing, and what it may do when the operator declared more

Date: 2026-07-30
Status: Implemented (first slice — `auth enroll`)
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — DX / machine empowerment

## The question

Running `refarm auth enroll` with no argument, the operator asked:

> *"se bem executado e com esforços de DX organizados … no fim, eu ainda tenho que dar um nome é? … se a tailnet for detectada (caso configurado) já oferecer enroll dos que estão disponíveis e usar o mesmo nome na tailnet? e quando não houver tailnet ou não estiver configurado qual seria o fluxo canônico? … preciso pensar em como deveria ser a experiência padrão e perceber que eu estaria querendo a padrão estendida por usar tailnet."*

That last clause is the whole design. There are two experiences, not one, and confusing them is how a
tool ends up either useless without an optional dependency or quietly requiring it.

## The shape already exists in this repo

`surfaces` settled the same question for reachability:

- `expose: "loopback"` — **canonical**. No dependency, always available, correct with zero
  configuration.
- `expose: "tailnet"` — **extended**. Requires a declaration, resolves through a real query, and
  **refuses fail-closed** when it cannot answer rather than degrading to something wider or narrower.

Enrolment is the second consumer of that same pattern, and should not invent a third vocabulary.

## C1 — Canonical: the operator names the device, and that is correct

With no tailnet declared, refarm has no source of identity for a machine it has never seen. Asking
for a label is irreducible — it is not a missing feature.

What the canonical flow owes the operator is that the ask be *good*: one prompt, a generic example
(never a name that looks like the operator's own), validation identical to the argument path, and a
graceful cancel. Those are now in place.

## C2 — Extended: when tailnet is declared, the device already has a name

A tailnet peer carries a MagicDNS name the operator already chose once. Making them invent a second
label produces **two names for one device**, which is worse than one prompt — it is a naming they
must now keep in sync mentally.

So when tailnet is declared and reachable, `enroll` with no argument should **offer the peers it can
see, named as the tailnet names them**, with the operator choosing. `packages/farm-client/src/tailnet.mjs`
already exports `tailnetPeers({ includeOffline })` and does not need to be rewritten.

Three rules keep this from becoming a footgun:

### C2.1 — Seeing a peer is not authorising a peer

The offer is a convenience for **naming**, never for enrolment. The operator picks which peers get a
credential, one at a time. "I can see eight devices" must never become "enrol eight devices", and no
affordance should make that a single keystroke.

### C2.2 — Typing a name stays available, always

A device that is not on the tailnet must remain enrollable. The extended flow *adds* an option; it
never removes the canonical one. The operator was explicit that this is not their case today and
still must not be foreclosed.

### C2.3 — "No peers" and "could not ask" are different answers

`tailnetPeers` currently returns `[]` for both — a `catch` swallowing the failure. Under the extended
flow that matters: an empty list reads as *"you have no devices"*, when the truth may be *"Tailscale
is not running"* or *"the CLI is missing"*. The operator's next action differs, exactly as it does
for a connection probe.

This is the same distinction the connection probe (`down` vs `unknown`) and the tailnet resolver
(`the tailnet is down` vs `could not ask`) already make. Its fourth appearance in the same codebase
is no longer a coincidence — **it is the shape of any answer obtained by asking the world**, and
`tailnetPeers` should be brought into line rather than special-cased around.

## C3 — Extended is offered, never assumed

The trigger is the **declaration**, not detection. If tailnet is not declared in `surfaces`, refarm
does not go looking for peers — even if Tailscale happens to be installed and running. Detection
decides *how* to satisfy a declared intent; it never decides *what* the operator wants.

That rule is what keeps the canonical flow honest on a machine that merely happens to have Tailscale
present, and it mirrors S1's "undeclared means closed" instead of contradicting it.

## Why this generalises

Named here because it will recur, and naming it once is cheaper than deciding it four more times:

> **A canonical flow depends on nothing and is always correct. An extended flow is unlocked by an
> operator declaration, uses detection only to satisfy that declaration, adds options without
> removing the canonical one, and distinguishes "the answer is no" from "I could not ask".**

Candidates already visible: the boot offer (canonical = nothing happens; extended = a declared
connection is offered), notification delivery (canonical = the terminal; extended = a declared
device), and model login (canonical = browser callback; extended = device code on a surface with no
browser).

## First slice, as taken

`enroll` gained the extended path: when `surfaces` declares tailnet, it offers the peers by their
tailnet names plus "type a name", with C2.1–C2.3 honoured. `tailnetPeers` grew the ability to say
*why* it returned nothing. The canonical path did not change.

### The seam: a candidate list, not a branch

The extension does not add a tailnet branch to the enrolment prompt. It **contributes candidates**
to the list `promptForIdentity` already renders:

- [`apps/refarm/src/commands/identity-candidates.ts`](../../../apps/refarm/src/commands/identity-candidates.ts)
  — the seam. `IdentityCandidateSource` (`{ id, collect() → { candidates, notices } }`),
  `collectIdentityCandidates`, and the label validate/sanitise pair. PURE, and deliberately ignorant
  of every source that exists.
- [`identity-sources.ts`](../../../apps/refarm/src/commands/identity-sources.ts) — the registry: the
  ONLY file that knows which extended flows exist.
- [`identity-source-tailnet.ts`](../../../apps/refarm/src/commands/identity-source-tailnet.ts) — the
  tailnet source, gated by `declaresTailnetSurface`.
- `promptForIdentity(operator, enrolledIdentities, candidates = [])` in `auth.ts` — with an empty
  list its behaviour is byte-identical to the canonical flow. It never learns what a source is.

Adding a second source (the boot offer, notification delivery, model login — the candidates this
document already names) means one new `identity-source-*.ts` and one line in the registry. The
canonical prompt, the seam, and every canonical test stay untouched.

### How each rule is actually enforced

- **C3** — `createTailnetIdentitySource().collect()` reads `.refarm/config.json` **from the
  filesystem only** (`loadRawSovereignConfig`, never the replicated node — exposure decides how THIS
  machine is reachable, the same doctrine `surfaces_decl.rs` states) and returns an empty report
  unless some surface declares `expose: "tailnet"`. Undeclared ⇒ `tailscale` is never spawned, on a
  machine that may well have it running. A test asserts on the injected runner; a mutation that
  removes the gate kills four tests.
- **C2.1** — one credential per invocation. The list is a `select`, not a multi-select, and picking
  a peer mints exactly one token.
- **C2.2** — "A new device" is always appended last, whatever contributed above it.
- **C2.3** — `tailnetPeersReport` reports `peers` / `no-peers` / `cli-missing` / `query-failed` /
  `bad-output`, and `reportToCandidates` turns the last three into a notice that names the reason
  ("Could not ask your tailnet …"), never into the empty list that reads as "you have no devices"
  ("Your tailnet answered: no other devices are on it right now."). Output that parses as JSON but
  is not a status document counts as *could not ask*, not as *no*.
- **Already enrolled** — a candidate matching an enrolled identity is folded into that entry and
  shown once, as a rotate ("on your tailnet — rotate its token").
- **The name** — the short MagicDNS handle (`tailnetShortName(DNSName)`), falling back to `HostName`.
  MagicDNS is unique within a tailnet and DNS-label-safe where a raw `HostName` is neither, and it is
  the handle the rest of refarm already addresses devices by (`farm-hello <hostname>`). A credential
  identity must not be ambiguous.
- **A peer name that fails label validation** — offered **repaired** and flagged
  (`needsConfirmation`), so choosing it opens a text prompt pre-filled with the repair and showing
  the original. The operator accepts or edits; nothing is silently rewritten. A name nothing can
  repair is skipped with a notice, never a crash.

Untouched, and tested as such: `--json`, the no-TTY path, and `enroll <label>`. All three return
before any source is consulted, so they never query anything.
