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

### C2.4 — Enrolment is not discovery

`tailnetPeers`' `includeOffline: false` default is right for `farm-hello`, which must reach a peer
*now* — an offline peer cannot answer, so offering it as a discovery target would be a false promise.
It is wrong for enrolment: a credential minted today is for a device to use *later*, and a device is
often offline for the ordinary reason that it has not been enrolled yet — inheriting the discovery
default would make the feature inert on exactly the tailnet it exists to help. So the extended source
queries with `includeOffline: true` of its own accord, while `tailnetPeers`' own default — and every
existing caller of it — stays untouched. An offline candidate is offered, never hidden, and marked so
the operator can tell it apart from one that is reachable right now.

## C3 — Extended is offered, never assumed. The operator invokes it.

**Detection never decides what the operator wants.** Refarm does not go looking for peers on its own,
even on a machine where Tailscale is installed and running. Something must *say* "look" first.

That something is an **explicit invocation**: an entry in the identity prompt
(`Discover devices on my tailnet…`) or the `--discover` flag. Picking it is the declaration of intent,
made at the point of use. Registration is not invocation — a registered source costs one line in a
list and zero spawns until it is chosen.

### This mechanism was revised. The first version was wrong.

The first implementation of C3 gated the extended path on `.refarm/config.json` declaring a surface
with `expose: "tailnet"`. The operator identified the flaw:

> `surfaces.sidecar-http.expose = "tailnet"` means *"bind this listener to my tailnet address"*. It
> does not mean *"consult my tailnet to name devices"*.

Two things were wrong with using one as a proxy for the other:

1. **A network-exposure declaration silently changed an unrelated command's behaviour.** An operator
   editing `surfaces` to control what binds where would not expect `auth enroll` to start spawning
   `tailscale`. A declaration must mean what it says, and only what it says.
2. **It failed the real case.** A machine on a tailnet that exposes no surface on it — which is
   normal, and is the operator's own situation — could never reach the extended flow at all. The
   feature was inert precisely where it was wanted.

The principle survives intact; only the mechanism moved. "Detection never decides" is unchanged. What
changed is *where the operator declares*: in a file, ahead of time and for a different purpose, versus
at the moment they want the thing. The second is more honest and strictly more capable — it needs no
prior setup, it works on a machine with no `surfaces` block at all, and it can be repeated
(`Discover again`) in a way a config file cannot.

It also removed a latent bug. The gate's config read was wrapped in a `try/catch` that turned "could
not read the declaration" into "nothing is declared" — the exact conflation C2.3 exists to prevent,
one layer up. It disappeared with the gate.

### What replaced it

- **One prompt entry per registered discovery source**, worded by the source itself
  (`IdentityCandidateSource.discovery`). A second source is a second entry: no new flag, no change to
  the prompt code.
- **`Discover again`** once a source has been asked. The peer list is a live snapshot, never cached —
  a device that joined after the prompt opened is one keystroke away. Nothing memoises `collect()`,
  and a re-query *replaces* that source's previous contribution rather than accumulating, so a device
  that left the tailnet also leaves the list.
- **`--discover`** on `refarm auth enroll`. Interactively it only skips a keystroke: the same query,
  run up front, so the list arrives populated. Non-interactively (no TTY, or `--json`) it **prints
  the candidates and mints nothing**, exit 0 — C2.1 held at the machine boundary, and the way a script
  discovers first and then enrols one device by explicit label in a second call.

`refarm auth enroll <label>` is untouched, and still returns before any source is consulted.

## Why this generalises

Named here because it will recur, and naming it once is cheaper than deciding it four more times:

> **A canonical flow depends on nothing and is always correct. An extended flow is unlocked by an
> operator declaration — which may be a config declaration or an explicit invocation, whichever is
> the honest place to declare *that particular* intent — uses detection only to satisfy it, adds
> options without removing the canonical one, and distinguishes "the answer is no" from "I could not
> ask".**

The corollary C3's revision earned: **do not reuse a declaration made for one purpose as the trigger
for another.** If the operator has to say something, make them say *this* thing. An invocation is a
declaration too, and often the cheapest honest one.

Candidates already visible: the boot offer (canonical = nothing happens; extended = a declared
connection is offered), notification delivery (canonical = the terminal; extended = a declared
device), and model login (canonical = browser callback; extended = device code on a surface with no
browser).

## First slice, as taken

`enroll` gained the extended path: the identity prompt carries a `Discover devices on my tailnet…`
entry, and picking it offers the peers by their tailnet names alongside "type a name", with C2.1–C2.4
honoured. `tailnetPeers` grew the ability to say *why* it returned nothing. The canonical path did not
change.

> Revised after the fact: the slice originally gated the extended path on a `surfaces` declaration.
> That gate is gone — see C3 above for what was wrong with it and what replaced it. `--discover`
> arrived in the same revision.

### The seam: a candidate list, not a branch

The extension does not add a tailnet branch to the enrolment prompt. It **contributes candidates**
to the list `promptForIdentity` already renders:

- [`apps/refarm/src/commands/identity-candidates.ts`](../../../apps/refarm/src/commands/identity-candidates.ts)
  — the seam. `IdentityCandidateSource` (`{ id, discovery, collect() → { candidates, notices } }`),
  `collectIdentityCandidates`, `replaceSourceCandidates`, and the label validate/sanitise pair. PURE,
  and deliberately ignorant of every source that exists.
- [`identity-sources.ts`](../../../apps/refarm/src/commands/identity-sources.ts) — the registry: the
  ONLY file that knows which extended flows exist. Registering a source does not run it.
- [`identity-source-tailnet.ts`](../../../apps/refarm/src/commands/identity-source-tailnet.ts) — the
  tailnet source. No gate, no config, no cache: `collect()` is one live query, run when invoked.
- `promptForIdentity(operator, enrolledIdentities, { candidates, sources, alreadyDiscovered })` in
  `auth.ts` — with no sources and no candidates its behaviour is byte-identical to the canonical
  flow. It knows a source has a label and can be invoked; it never learns what one asks.

Adding a second source (the boot offer, notification delivery, model login — the candidates this
document already names) means one new `identity-source-*.ts` and one line in the registry. It appears
in the prompt as its own entry, worded by itself. The canonical prompt, the seam, and every canonical
test stay untouched.

### How each rule is actually enforced

- **C3** — nothing in the enrolment graph reads `.refarm/config.json`. Two tests hold that: the
  config package is mocked and asserted **never called** across a full enrolment *including* a
  discovery, and a static check asserts no enrolment module so much as names it. `collect()` runs
  only from an invoked entry or `--discover`; a test drives the whole prompt without picking the
  entry and asserts the injected runner recorded **zero** spawns. Re-adding the old gate kills 20
  tests.
- **Live, never cached** — `collect()` memoises nothing, and `replaceSourceCandidates` drops a
  source's previous answer instead of merging it. The test that pins this asserts the injected
  runner was called **twice** after a `Discover again`; memoising `collect()` kills it.
- **C2.1** — one credential per invocation. The list is a `select`, not a multi-select, and picking
  a peer mints exactly one token. Non-interactively, `--discover` prints and returns without writing
  a policy file at all — a test asserts the file does not exist; removing the short-circuit kills it.
- **C2.2** — "A new device" is always appended last, whatever contributed above it, and it is
  asserted present both *before* and *after* a discovery.
- **C2.3** — `tailnetPeersReport` reports `peers` / `no-peers` / `cli-missing` / `query-failed` /
  `bad-output`, and `reportToCandidates` turns the last three into a notice that names the reason
  ("Could not ask your tailnet …"), never into the empty list that reads as "you have no devices"
  ("Your tailnet answered: no other devices are on it right now."). Output that parses as JSON but
  is not a status document counts as *could not ask*, not as *no*.
- **C2.4** — `createTailnetIdentitySource` queries `tailnetPeersReport` with `includeOffline: true`,
  so a tailnet whose peers are all offline still reads as `peers`, never collapsing into the
  `no-peers` notice. `reportToCandidates` marks each offline candidate's description
  (`"on your tailnet, offline"`, plus `"(last seen …)"` when the status document's `LastSeen` is
  present) so it reads apart from an online one at a glance. `tailnetPeers`' own default is
  unchanged, and a farm-client test pins it.
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
before any source is consulted, so they never query anything — unless `--discover` is passed, which
is the operator asking, and which reports without minting.

### The canonical guarantee, still pinned

With zero registered sources, `promptForIdentity` produces the pre-change `options` array **verbatim**
— that test carries the baseline literally and is the thing to break if the seam ever leaks. With one
source registered, the only difference is the discovery entry; nothing else moves.
