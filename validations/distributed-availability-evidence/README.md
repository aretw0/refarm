# Distributed Availability Evidence Proof

This validation is the first proof following ADR-075's Pears/Holepunch reference pressure. It
models distribution as identity, update, rollback, availability, and trust evidence over existing
Refarm manifests.

The fixture deliberately uses proof-local schemas and `refarm-proof://` references. It composes:

- `artifact-contract-v1` task artifact manifests;
- `release-engine` audit records and SHA-256 digest evidence;
- remote-workspace node evidence as a read-only availability signal;
- explicit seed/replica policy and rollback target.

Run:

```bash
pnpm run distributed-availability:poc:test
```

Non-goals:

- no Bare, Hypercore, Hyperdrive, Corestore, Hyperswarm, HyperDHT, or Pear runtime adoption;
- no public install/update contract;
- no product-ready P2P substrate;
- no package extraction;
- no `apps/refarm` ownership of the contract.
