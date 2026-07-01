# Research: external references — peerd & Accordion (2026-06-30)

> Reference/influence notes, in the spirit of ADR-075 (Pears as a distributed-runtime reference).
> These are lessons to aggregate, not dependencies to adopt. Each lands as its own spec/ADR only when
> a proof and consumer pressure justify it.

## Runtime naming boundary (read first — avoid conflation)

Two **distinct** agent runtimes exist in the ecosystem; cite them precisely:

- **`pi` (`pi.dev`)** — the coding agent curated **downstream in `agents-lab`**, with its own existing
  extension/skill ecosystem. External/upstream to Refarm.
- **`pi-agent`** — **Refarm's** agent runtime (`packages/pi-agent`), named in homage to `pi`; may be
  renamed **`farmhand`**. Held private until the item-9 proofs are boring.

Rule: what serves **`pi`** belongs downstream in `agents-lab`; **Refarm takes the learnings** for its
own runtime (`pi-agent`/`farmhand`). `agents-lab` later opens a front to balance work across both
runtimes. **Never merge the two.**

---

## 1. peerd — browser-native agent harness (BYOK, no backend, P2P)

Source: `github.com/NotASithLord/peerd`. Vanilla ESM, browser platform primitives, WebRTC P2P preview.

### Already on Refarm's path (confirmation, not new work)

- **Structural isolation over convention** — the orchestrator that holds keys does *not* hold the
  environment's tools; keyless actors own them and return fenced summaries. This is Refarm's WASM
  **capability sandbox** (`agent-tools`, `validations/extension-sandbox-poc`, WIT capability model) and
  the ADR-078 control/workload separation. ✓
- **Vault unlock + passkey, no vendored crypto** — decrypt separate from storage, explicit passkey
  unlock. This is `silo`'s direction (storage/identity closure split; the v0.2 roadmap already names
  `passkey|secure-enclave|tpm`). ✓
- **P2P dweb (WebRTC)** — ADR-075 already tracks P2P distribution as a reference.

### New lesson to aggregate → Refarm-native

- **Egress chokepoint.** All outbound traffic from compute environments routes through one
  `safeFetch`/`webFetch` that enforces provider allowlists and blocks SSRF. Candidate application:
  - `@refarm.dev/source-web` — pair its session/pacing/redaction provenance with an **egress
    allowlist** so an authenticated web capture cannot reach arbitrary hosts.
  - ADR-074 control plane — the "policy precedes execution" rule gains a concrete egress gate.
  Gate: proof-gated; spec it when `source-web` or a remote node needs the enforced allowlist.

## 2. Accordion — reversible context management (integrates with `pi` = `pi.dev`)

Source: `github.com/a-Fig/Accordion`. SvelteKit/Tauri; integrates with the **`pi` agent (`pi.dev`)** —
so it is **`agents-lab` territory**, not a Refarm dependency. Refarm learns the *pattern* for its own
runtime.

### Pattern to learn (for `pi-agent`/`farmhand`, via the session layer)

- **Reversible folding over destructive compaction** — fold cold turns into deterministic digests that
  the agent can *unfold* on demand, instead of lossy summaries or a sliding window. A protected working
  tail stays unfolded.
- **Context map (visibility is agency)** — the agent's memory is something the operator can see and
  steer, not a black box.
- **Hierarchical state for unbounded sessions** — turns → groups → meta-groups, to scale long runs.
- **Small-model relevance over a vector DB** — a ~500M attention proxy ranks relevance locally; aligns
  with `plugin-tem`'s structural-intelligence (no vector DB).

Refarm application: `session-contract-v1` / the reference-driver `interaction-driver` could grow a
**reversible context-folding** shape (fold/unfold as tool calls; a protected tail) — the runtime layer
lacks this today. Boundary: the work *for `pi`* stays in `agents-lab`; Refarm adopts the pattern for
`pi-agent`. Gate: proof/second-consumer, per the reference-driver `adoptionCriteria`.

## Summary

| Reference | Already ours | New lesson to aggregate | Home |
|---|---|---|---|
| peerd | sandbox isolation, silo passkey, ADR-075 P2P | **egress chokepoint** | Refarm-native (`source-web`, ADR-074) |
| Accordion | small-model relevance ↔ `plugin-tem` | **reversible context folding** | pattern for `pi-agent`; the pi-facing work is `agents-lab` |
