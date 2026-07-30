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

## O5 — TS surfaces bind on the declaration, not on a policy file existing somewhere

`refuseUnguardedNonLoopbackBind`'s current criterion — "does `REFARM_AUTH_POLICY` name a file that
exists" — measures the wrong thing entirely. It is replaced by the same rule the Rust guard follows:

- undeclared ⇒ loopback (S1);
- declared ⇒ the declaration is the ceiling, and a flag may only narrow it (S5);
- a declared gate the surface cannot enforce ⇒ refused (S3), which is what makes `gate: "none"`
  necessary rather than convenient.

`authPolicyPresent` does not disappear — a surface that *does* verify bearers still needs to know a
policy exists. It stops being the answer to a question it never addressed.

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
