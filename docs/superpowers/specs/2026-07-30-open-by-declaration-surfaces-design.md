# Open by declaration — one `surfaces` vocabulary, two enforcers

Date: 2026-07-30
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — interfaces, devices and nodes
Answers: question 2 deferred in `packages/tractor/src/host/host_effects_bridge/surfaces_decl.rs`

## What forced this

The operator wanted the cold-bootstrap kit reachable from their phone, which means serving
`.refarm/dist` over the tailnet. Measuring first turned up three facts that make the obvious move
wrong:

1. **`refarm web serve` never reads `Authorization`.** Not once. It serves files.
2. **`authPolicyPresent()` only checks that `REFARM_AUTH_POLICY` names a file that exists.** It does
   not read it, validate it, or relate it to the caller.
3. **TypeScript surfaces never consult `surfaces`.** Nothing in `web-serve.ts` reads the declaration.

Together: a TS listener may bind off-loopback because *some other surface* has credentials, while
declaring nothing and verifying nothing. That is the appearance of a gate without a gate — precisely
what [S3](2026-07-29-declared-surfaces-design.md) forbids.

And a fourth fact makes it urgent rather than merely untidy: `parse_surfaces` is **fail-shut**, and
it refuses unknown surface names. Declaring `dist-http` in `.refarm/config.json` today would make the
Rust daemon refuse to boot. The two runtimes do not merely disagree about the catalog — one of them
treats the other's entries as corruption.

## O1 — A surface may not declare a gate it cannot enforce, so it must be able to declare openness

S3 already says the first half. The missing half is that **refusing to lie leaves you with nothing
to say.** A Node surface that verifies no bearer cannot honestly declare `device-token`; today its
only alternative is to declare nothing, which is indistinguishable from an oversight.

So the vocabulary gains an explicit gate value meaning *deliberately open*. The distinction it buys
is the whole point: an auditor reading the config can tell **a choice from a forgetting**, and a
reviewer can ask "why is this open?" instead of never noticing it is.

## O2 — Openness is only admissible with the constraints that make it safe

`gate: "none"` alone would be a hole with paperwork. It is admissible only together with:

- **an admitted-device transport** — `expose: "tailnet"` or another transport whose peers the
  operator already admitted. Never `host:0.0.0.0`, never public. Arriving over such a transport is
  itself the first factor, exactly as
  [the enrolment design](2026-07-30-phone-initiated-enrolment-design.md) argues;
- **read-only** — the surface may serve, never accept a mutation;
- **nothing that grants anything.** Fetching an artifact is not authorisation. Integrity is the
  artifact's own problem, and the kit already carries sha256 per file.

A declaration combining `gate: "none"` with a wider exposure must be **refused at parse time**, not
warned about. Silence means closed; a refused declaration means the operator learns immediately.

## O3 — Why the bootstrap surface *must* be open, and why that is not a concession

A device with no credential must be able to fetch the installer. Requiring a bearer to obtain the
thing that lets you obtain a bearer is a closed loop.

So openness here is not a weakening we tolerate — it is the correct shape for this surface, and the
constraints in O2 are what make it correct rather than lax. Any design that "fixes" it by adding
authentication has broken cold bootstrap and not noticed.

## O4 — One vocabulary, two enforcers

`KNOWN_SURFACES` widens so that a single `.refarm/config.json` is parseable by both runtimes. The
split of responsibility:

- **Rust** validates the *shape* of every declared surface and enforces the semantics of the two it
  owns (`sidecar-http`, `daemon-ws`). A TS surface's entry must parse and must satisfy O2's
  combination rules, but Rust never binds it.
- **TypeScript** enforces the surfaces it owns, reading the same declaration from the same file.

What must not happen is two vocabularies. A config file must mean one thing, and today a `gate`
value the TS side invented would crash the Rust daemon at boot.

**Built (2026-07-30), Rust half — O1, O2 and O4.** `packages/tractor/src/host/host_effects_bridge/
surfaces_decl.rs` gained `SurfaceGate::Open` (`"gate": "none"`), O2's combination rules as parse-time
refusals, and a widened `KNOWN_SURFACES`; `sidecar::bind_guard` refuses `Open` explicitly in both
guards, and `any_surface_declares_device_token_gate` still answers only to `device-token`, so
declaring openness can never derive an auth-policy path. Two decisions the implementation had to
make, recorded because the prose above underdetermines them:

- **One name for the `refarm web serve` listener: `web`** (alongside `capabilities`), not
  `dist-http`. O6 establishes that the artifact routes and the proxy routes share ONE listener and
  that declaring it open opens all of them — "this cannot be waved off as 'a different surface'". A
  name taken from the payload invites exactly that excuse, and admitting both names would let one
  listener carry two `expose`/`gate` values with no answer as to which wins, which is the
  two-vocabulary failure O4 exists to prevent. Surfaces are named for listeners here, as
  `sidecar-http` and `daemon-ws` already are. `dist-http` stays refused as an unknown name.
- **Only the literal `expose: "tailnet"` counts as an admitted-device transport.** A
  `host:<ip>` inside 100.64.0.0/10 does NOT qualify: `parse_expose` shape-validates a literal
  without resolving or trusting it (S2), that range is RFC 6598 carrier-grade NAT which Tailscale
  merely borrows (ISPs and containers use it too), and inferring an *admission* property from a
  numeric range would be the parser manufacturing precisely the appearance-of-a-gate O1 forbids.
  `"tailnet"` is also the form that fails closed at bind time when the tailnet is down, where a
  hardcoded 100.x literal would bind regardless.

Also settled here: `"gate": "device-token"` is now refused on a surface that verifies nothing at
*every* `expose`, loopback included — question 2 of the 07-29 design, answered in the direction that
doc called "honest and smaller", which is what makes `"gate": "none"` necessary rather than
convenient. And `sidecar-http`/`daemon-ws` may not declare themselves open beyond loopback at all:
they dispatch agents and accept CRDT writes, so O2's read-only clause excludes them.

## O5 — TS surfaces bind on the declaration, not on a policy file existing somewhere

`refuseUnguardedNonLoopbackBind`'s current criterion — "does `REFARM_AUTH_POLICY` name a file that
exists" — measures the wrong thing entirely. It is replaced by the same rule the Rust guard follows:

- undeclared ⇒ loopback (S1);
- declared ⇒ the declaration is the ceiling, and a flag may only narrow it (S5);
- a declared gate the surface cannot enforce ⇒ refused (S3), which is what makes `gate: "none"`
  necessary rather than convenient.

`authPolicyPresent` does not disappear — a surface that *does* verify bearers still needs to know a
policy exists. It stops being the answer to a question it never addressed.

**Built (2026-07-30), all three TS listeners.** `refarm web serve` moved first; `refarm serve` and
farmhand's CRDT relay followed. The rule now lives once, in `@refarm.dev/std`:
`resolveDeclaredSurfaceBind` writes down the ORDER of the four questions (can this listener enforce
what was declared → resolve `tailnet` → what an absent flag means → does the declaration permit this
bind), because getting them in the wrong order is how a listener refuses with the wrong reason or
silently narrows where it should refuse. `web-surface.ts` keeps only what is genuinely local:
asking Tailscale through the app's process seam, the config root, and O6.

Which surface each listener IS, named for the LISTENER as the `dist-http`/`web` decision settled:
`refarm serve` is `capabilities`; farmhand's relay is `daemon-ws` — same port 42000, same binary
Loro relay, and `daemon/ws_server.rs` opens with "replaces farmhand on port 42000". Two
implementations of ONE listener.

`daemon-ws` forced a distinction the per-SURFACE capability table cannot make, and it is the one
new rule this slice adds. That surface really does have a gate — ADR-093's handshake, in the Rust
daemon — while farmhand's relay verifies nothing. So `refuseGateThisListenerCannotEnforce` asks
what THIS listener verifies, and refuses even when the resolved host came out loopback: an
unresolved `tailnet` falls back to loopback, so without that clause the relay would bind 127.0.0.1
and say nothing while the operator believed their declaration took effect. An explicit loopback
host is the one case it lets through — the operator narrowed it themselves, so nothing is exposed
and nothing is claimed.

Both converted listeners also carried the **defaulted-flag defect** the sidecar had: `refarm serve
--host` held a commander default and `FARMHAND_WS_HOST` fell back to `DEFAULT_BIND_HOST`. A value
always present always narrows, so the declaration could never take effect and nothing would say so
— inert AND silent. Both now pass the absence through, pinned by a test on each, including on
`web serve`, which had the fix but no test protecting it.

One listener is deliberately NOT converted: `serveCapabilities`
(`packages/capabilities-v1/src/mount.ts`), the SDK primitive a white-label app mounts. Its host
comes from its consumer rather than from a flag, so *which* declaration it should read is a
question about that consumer's layout, not about this design.

Corrected in passing: `refuseBindOutsideDeclaration`'s `device-token` arm refused unconditionally
rather than "on a surface that cannot enforce it", as its own doc comment said. Invisible until now
because no TypeScript listener bound `sidecar-http` or `daemon-ws`.

## What this unblocks

With O1–O5, `dist-http` can be declared honestly, `refarm web serve` binds to the tailnet because
the operator said so, and the phone can cold-bootstrap with one `curl`. The kit's own integrity
check does the job authentication was never doing here.

## O6 — One listener, several routes: declaring it open opens all of them

`refarm web serve` is not only a file server. It also proxies to the daemon's WS
(`127.0.0.1:42000`) and HTTP sidecar (`127.0.0.1:42001`). Those routes share the listener, so
declaring the surface open exposes them too — this cannot be waved off as "a different surface".

What measurement shows, and what still has to be proven rather than assumed:

- the proxy **forwards the caller's headers upstream**, so a request without a credential reaches a
  gate that already answers `401`. The sidecar's device-token gate and the WS handshake (ADR-093,
  verified live today) are therefore still the enforcers. Proxying does not bypass them;
- but the WS is deliberately loopback-only, and proxying makes it reachable from the tailnet with
  the handshake as the sole defence. That is a real change in exposure even though the gate holds.

So the rule for this surface is: **artifact routes are read-only and open by declaration; proxy
routes inherit their upstream's gate, and that inheritance must be demonstrated by test, not
asserted.** A proxy route whose upstream has no gate may not be served on an open surface at all.

Implementation must therefore include a test that an unauthenticated request through each proxy
route is refused by the upstream — the same three probes already run by hand against the sidecar
(no token, wrong token, valid token), driven through the proxy instead of directly.
