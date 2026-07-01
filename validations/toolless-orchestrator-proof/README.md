# Tool-less Orchestrator Proof

This proof splits the peerd keyless-actor lesson out from the broader
verification-as-completion proof.

The model is intentionally small:

- the conductor may hold operator keys, but owns no environment tools;
- the actor owns bounded environment tools, but is keyless;
- delegation requests carry policy and capability bounds, not secret material;
- the actor returns fenced evidence;
- the conductor can complete only by verifying the fence and source evidence.

Boundary: this is proof-local. It does not extract a package, mutate
`pi-agent`/`farmhand`, add a global shell proxy, or move runtime policy into an
app. Candidate homes remain the runtime conductor, process handoff,
environment ceilings, and future worker/session contracts if dogfood or a
second consumer proves the pressure.

Run:

```bash
pnpm run toolless-orchestrator:poc:test
```
