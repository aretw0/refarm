# A node is thirty kilobytes; the rest is its past

**Date:** 2026-08-13
**Lane:** [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — interfaces, devices and nodes (the
cold-bootstrap rung)
**Serves:** ISS-123, from the other end. `refarm backup` answered *"copy the bytes"*; this answers
*"declare the node"*.
**Pairs with:** [`2026-07-31-declaring-is-authoring-design.md`](2026-07-31-declaring-is-authoring-design.md)
(the A2 invariant this document has to defend),
[`2026-08-03-declared-node-base-design.md`](2026-08-03-declared-node-base-design.md) (declared, never
detected), [`2026-07-30-phone-initiated-enrolment-design.md`](2026-07-30-phone-initiated-enrolment-design.md)
and [`2026-07-31-sovereign-tls-design.md`](2026-07-31-sovereign-tls-design.md) (the identity this
carries), [`2026-07-31-emoji-sas-scoped-credential-design.md`](2026-07-31-emoji-sas-scoped-credential-design.md)
(a named successor custody).
**Supersedes:** nothing. `refarm backup` keeps a job, and that job gets smaller. See D7.

## What forced this

The operator, on reading the bundle built for him the day before:

> *"pra constar eu não estou interessado em um backup, gosto mais da estratégia de salvar em algum
> local as convenções de preparação desse nó, como existe a abordagem nix … gostaria de já vislumbrar
> como seria para os nós do refarm para eu não ter que lidar com backup desse jeito mais bruto, quero
> elegância e assertividade."*

`refarm backup` is not wrong. It does what it says, it names its exclusions, and it verifies itself.
What it cannot do is be *read*. A 589 KB bundle is not reviewable, not diffable, not committable, and
says nothing about intent. The measurement it made possible is what refutes it as the answer.

## Measure first

### The operator's node, 2026-08-13, by nature

| nature | files | bytes | reproducible from a declaration? |
| --- | ---: | ---: | --- |
| **decision** | 2 | **5.5 KB** | it *is* the declaration |
| **identity** | 8 | 21.1 KB | no, but small enough to carry |
| **secret** | 3 | 3.4 KB | no, and today excluded by default |
| history | 8 | 226.3 KB | **never.** Nothing reproduces a record of the past |
| storage | 4 | 336.0 KB | by replication instead (D5) |
| **total** | **25** | **592.3 KB** | |

**The sentence this design exists for: the bundle is 95% of the bytes for 0% of the reconstitution
decisions.** The entire decision surface of the operator's node is `~/.refarm/config.json`, at 4,962
bytes, ten top-level keys (`node`, `tractor`, `trusted_plugins`, `approvedPermissions`, `processes`,
`surfaces`, `workspaces`, `spawnEnv`, `delivery`, `connections`).

Decision + identity + secret is **13 files and 30.0 KB**. That is the artefact.

### What the repository already has, and what it does not

Measured the same day, because three plausible designs died on these facts:

| assumption | measured |
| --- | --- |
| "`vault-contract-v1` is where secrets go" | **False.** It is a *knowledge* vault: `organize`, `search`, `corpus health`, `recordToVaultNote`. Nothing cryptographic. |
| "heartwood can seal" | **False.** `packages/heartwood/wit` exports exactly `sign`, `verify`, `generate-keypair`. |
| "there is an encryption primitive somewhere" | **False.** Zero hits for `createCipheriv`/`aes-256-gcm`/`sops`/`age1` across `*.ts`/`*.rs`/`*.mjs`. The only matches for "sensitive" are header *redaction* in the Rust host. |
| "key derivation exists" | **Stub.** `packages/silo/src/key-manager.js`: `deriveChildKey(path)` returns `"sk_dummy_child_key_" + path`. |
| "replication is aspirational" | **Real.** `packages/sync-loro` has `loro-crdt-storage.ts`, `peer-id.ts`, `node-sync-token.ts` and a `sync-v1` conformance suite. The `default.peer` beside `default.db` on the operator's node is a CRDT document. |
| "the derive-don't-store doctrine is new" | **Already written.** `packages/wallet/src/recovery.ts` states it: *"perdi o celular, recupero minha identidade"* — the provider re-derives the same identity from a re-authenticated session; the private key never leaves the sandbox. |

The last two rows are why D2 and D5 are shaped as seams rather than as choices made now.

---

## D1. One file, thirty kilobytes, sealed in place

The operator's choice, given three shapes: **a single versioned file that IS the node**, decisions in
cleartext, identity and secrets encrypted inline.

```jsonc
{
  "$schema": "refarm/node-declaration.v1",
  "node": { "name": "serpro-1577853", "declaredAt": "2026-08-13T18:04:11Z" },
  "governance": "local",                    // D3
  "declarations": { /* .refarm/config.json, VERBATIM */ },
  "authPolicy":   { /* .refarm/auth-policy.json, VERBATIM */ },
  "seal": {                                 // D2 — every field here is CLEARTEXT
    "custody": "passphrase",
    "kdf":     { "name": "scrypt", "N": 131072, "r": 8, "p": 1, "salt": "…" },
    "cipher":  "aes-256-gcm",
    "iv": "…", "tag": "…",
    "payload": "…"                          // { files: { ".refarm/tls/ca.key": "<base64>", … } }
  },
  "reAuthenticate": ["cloudflare", "github", "openai-codex"],
  "notCarried": { "history": 8, "storage": 4, "bytes": 575815, "replicates": true }
}
```

**`declarations` is the config file verbatim, not a translation.** This is load-bearing and it is the
whole of the repository's answer to the A2 invariant (below). A re-encoding would be a second
vocabulary, and a second vocabulary rots against the first the first time a key is added. The
declaration block is a *container*, and `refarm node apply` writes those bytes back.

**Why the seal is inline rather than a sibling file.** The operator was offered a cleartext
declaration plus a separate encrypted identity capsule and refused it: two artefacts are two lifecycles
and two ways to arrive with only one of them. A single file is either complete or absent, a state a
human can check by looking.

### What is sealed, and what is deliberately not

The rule is **not** "everything secret". It is: *seal what cannot be re-obtained by logging in.*

| | sealed | why |
| --- | --- | --- |
| `.refarm/node-id`, `node.json` | **yes** | a new one is a different node to every peer |
| `.refarm/tls/ca.key` and the surface keys | **yes** | regenerating is not recovery — every enrolled device must be re-enrolled by hand |
| `.refarm/delivery/telegram.token` | **yes** | no login rebuilds it; it comes from a conversation with BotFather |
| silo OAuth credentials, API keys | **NO — named instead** | **they expire.** A carried token is garbage that looks like safety: it restores a node that appears configured and fails on first use. `reAuthenticate` lists them; `splitSiloContent` already draws this line and it is the right one. |

That last row is the same three-states discipline in another costume: *present* is not *usable*. The
wizard learned this on 2026-08-12 and it cost a day; the declaration does not get to relearn it.

---

## D2. Custody is a declared dimension from the first commit; the passphrase is the floor

The operator's instruction, verbatim: *"gostei das outras propostas, quero começar com essa e deixar
aberto para que o que for melhor no longo prazo também chegar depois, deixando de forma clara que é
essa a intenção."* So it is stated here as intent rather than left to be inferred from a string field.

**`seal.custody` is a string, and an unrecognised value is an ANSWER, not a crash.** Reading a sealed
envelope has three outcomes and never two:

| | meaning | what the operator is told |
| --- | --- | --- |
| `sealed-by-known-custody` | this build implements it | ask for the passphrase |
| `sealed-by-unknown-custody` | a newer refarm sealed this | *"this file was sealed by custody `peer`, which this build does not implement — use a refarm that does"* |
| `unreadable` | truncated, corrupt, not a declaration | say so; never confuse it with the row above |

The second row is the entire reason `custody`, `kdf` and `cipher` sit in cleartext beside the payload
rather than inside it. A format that cannot explain why it will not open is a format that strands its
own operator.

### Why the passphrase is first, and not merely first-available

It is the only custody with **no liveness requirement of any kind**:

| | disk wiped | no internet | no other node | no account anywhere |
| --- | :-: | :-: | :-: | :-: |
| **passphrase** | ✓ | ✓ | ✓ | ✓ |
| derive-from-session | ✓ | ✗ | ✓ | ✗ |
| peer custody | ✓ | ✗ | ✗ | ✓ |

The scenario that forced this whole line of work is *"o mesmo computador caso formatado"*. Only the
first row survives it unconditionally. The other two are better in every ordinary week and worse in
the one week that matters, which makes them successors, not starting points.

**Named successors** (the seam exists for them from the first commit):
`custody: "derive-from-session"`: `packages/wallet/src/recovery.ts`, once
`silo/key-manager.js#deriveChildKey` stops being a stub.
`custody: "peer"`: emoji-SAS over a peer that still trusts this node, per the phone-initiated
enrolment design.

### The primitive: `node:crypto`, measured

`scrypt` (N=2¹⁷, r=8, p=1) + `AES-256-GCM`, both from the Node standard library. **Zero new
dependencies.** `age` costs an external binary on every machine that must restore; `sops` costs a
package plus a config format; sealing inside heartwood costs new Rust in a WASM component and a
rebuild-install cycle before the feature can be used at all. The measurement decides this one; it is
not a preference.

---

## D3. The node stays the source. Governance is declared, per node.

This is the section that had to argue with an existing invariant, so it states the argument.

### The invariant it must not break

`2026-07-31-declaring-is-authoring-design.md`, A2:

> *"A second source of truth would undo the whole catalog doctrine: the config would stop being the
> answer to 'what is declared here', and the operator would have to know which of two places won."*

A versioned `node.refarm.json` is, on its face, exactly that second place.

### Why the Nix answer is the wrong one here

NixOS makes `/etc/nixos/configuration.nix` the source and `/etc` a generated artefact. It works
because **a NixOS machine is a machine one administers**. A refarm node is a participant that must be
able to act alone. If the node's intent lives in a repository elsewhere:

- the **phone** becomes read-only. `phone-initiated-enrolment` can start operations but can no longer
  change anything;
- **cold bootstrap** becomes impossible: a fresh node cannot be configured until it clones something;
- **`refarm sow`** needs a checked-out repository on a machine that may not have one.

A node that cannot redefine itself without a repository present is not sovereign; it is a client of
the repository. The elegance would be bought with the exact property being sought.

### The resolution: no second source, and the posture is declarable

1. **`.refarm/config.json` remains the single source of truth.** Unchanged. The wizard writes it,
   hand-editing keeps working, `config set` keeps working, `config history` keeps recording.
2. **The versioned file is a projection with a `governance` field**, and that field says which
   direction is authoritative *for this node*:
   - `governance: "local"` — the node decides; the file records what it decided. The operator's PC.
   - `governance: "repo"` — the file is the intent; a local change becomes a *proposal* rather than
     an accomplished fact. A server, later.
3. **"Git is the source" is a discipline, not a mechanism.** It is `governance: "repo"` plus the habit
   of always editing there. It needs no separate architecture, and building one would have produced
   two code paths for one idea.

There is still exactly one answer to *"what is declared here"*: the config file. `governance` answers
a different question, *"who is allowed to have written it"*, and the two never compete.

---

## D4. `diff` is directional and three-stated from the first slice, so `promote` is additive later

The slice order below ships `diff` before `promote` exists. That is only safe if `diff` is built with
the vocabulary `promote` will need, or the third slice becomes a rewrite of the first.

Per key, four verdicts and never a boolean:

| verdict | meaning |
| --- | --- |
| `aligned` | the node and the file agree |
| `node-only` | the node has it; the file does not — under `local` this is *pending emission*, under `repo` it is *an unpromoted proposal* |
| `source-only` | the file has it; the node does not — `apply` would add it |
| `divergent` | both have it, differently — the only verdict that requires the operator |

And a fifth at the whole-file level: `uncomparable`: the file is sealed with a custody this build
cannot open, so **nothing** is known about identity alignment. Reporting `aligned` for the cleartext
half while silently skipping the sealed half would be the presence-read-as-health defect a third time.

`apply` never writes without printing this diff first and waiting. CLAUDE.md §8 requires it, and the
file being small enough to read is precisely what makes the requirement affordable.

---

## D5. Data replicates; it is not carried. And today it does **not** replicate.

The operator's choice for the 562 KB: *replicam pela malha*. `sync-loro` is real and his `.peer` file
is already a CRDT document, so this is a seam, not a fiction.

**It is also, today, false in practice, and the design says so out loud.** He has one node. One node
is not a mesh, and a CRDT with no peer is a local file with extra steps.

So `apply` reports replication in three states and never assumes:

```
✓ identidade + 10 declarações              (30 KB)
→ dados: nenhum par alcançável
  ⚠ este é o único nó que os tinha. 562 KB não voltam por aqui.
     enquanto não houver um segundo nó:  refarm backup create <destino>
```

| state | condition |
| --- | --- |
| `replicated` | ≥1 peer reached, changes applied, counted |
| `not-replicated` | zero peers reachable — **named as a loss, with the escape hatch** |
| `unknown` | replication was not attempted (offline flag, no sync capability loaded) |

Proving `not-replicated` → `replicated` requires a second node. That is a real prerequisite of this
design and it is listed among the debts rather than assumed away.

---

## D6. What the declaration refuses to carry

- **history** (`sas/`, `task-results/`, `task-memory.db`, `operations.json`, `scarecrow-audit.ndjson`,
  `streams/activity.ndjson`) — nothing reproduces a record of the past, and a declaration that carried
  it would stop being a declaration.
- **storage**: D5.
- **`foreign` namespaces** — already decided 2026-08-13: undeclared is not this node's. 71 files on
  the operator's node, carried by nothing, deleted by nothing.
- **`cache`**: 69 files, named with what rebuilds them.
- **expiring credentials**: D1.

`refarm node declare` refuses to emit while the layout reports any `unregistered` path, for the same
reason `backup` does: an unregistered path means something writes where the layout does not describe,
which is how a CA private key went unnoticed for months.

---

## D7. `refarm backup` keeps its job, and its job gets smaller

It is not deprecated and it is not renamed. It becomes what the measurement says it always was: **the
instrument of the 562 KB the declaration does not cover**. Until a second node exists, they are also the only
honest answer for them.

| | `refarm node declare` | `refarm backup create` |
| --- | --- | --- |
| carries | decisions + identity, 30 KB | everything irrecoverable, 592 KB |
| readable | yes: commit it, diff it, review it | no, a bundle |
| replayable on a fresh node | yes | yes |
| covers history and storage | **no** | yes |
| needs a passphrase | yes | no |

`refarm backup plan` gains one line pointing at the other command, so the operator meets the choice
where he already is.

---

## Slices

| # | ships | why here |
| --- | --- | --- |
| **1** | `node declare` / `node apply` / `node diff` + the seal + passphrase custody | this is what replaces the brute bundle |
| **2** | `node declare --check` wired into the `agent finish` lanes | a snapshot that can go stale silently *will* |
| **3** | `governance` in the config + `node promote` | additive over slice 1 if D4 held |
| **4** | successor custodies (`derive-from-session`, `peer`) | the seam exists from slice 1; neither is needed to stop using bundles |

Slice 1 is the whole of what the operator asked for. Slices 2–4 are what keep it from decaying.

## Testing

Pure functions, tested without a node:

- `seal` / `unseal` round-trip; wrong passphrase → a *named refusal*, never a stack trace.
- **an unknown `custody` is an answer** — asserted directly, because it is the format's promise to its
  own future.
- **no secret in the cleartext half** — asserted by searching the whole serialised cleartext for the
  secret *values*, not by checking key names. The same shape as `splitSiloContent`'s existing test:
  a renamed or nested key must not slip past.
- **expiring credentials are named, not carried** — `reAuthenticate` lists them and the payload does
  not contain them.
- `diff` returns all four per-key verdicts plus `uncomparable`, each pinned.
- `declare` refuses while any path is `unregistered`.
- `apply` on a node with no peer reports `not-replicated` **and names the escape hatch** — the
  assertion that stops silence from reading as success.

Directory independence: `node declare` and `node diff` are read-only and go in `PROBE_COMMANDS`;
`node apply` is a mutator and is declared in the exclusions, like `init`.

## Debts, stated rather than discovered later

1. **One node means no replication.** D5 cannot be proven end-to-end until a second node exists. Until
   then `refarm backup` is load-bearing, not vestigial.
2. **`deriveChildKey` is a stub.** `custody: "derive-from-session"` is a named successor, not a near
   one.
3. **The passphrase is a real single point of failure.** Forgetting it makes the file noise. This is
   accepted deliberately: it is the price of the only custody that survives a wiped disk with no
   network and no peer. `declare` says so at the moment of sealing, once, plainly.
4. **ISS-121 and ISS-122 are untouched.** The sentinel in the live model route and the
   one-slot-per-provider silo are orthogonal, and a declaration would faithfully carry the sentinel
   forward. ISS-121 should be cleared on the node before the first `declare`.
5. **The ledger entry is not written.** `.project/**` is a protected surface (CLAUDE.md §8); filing
   this against ISS-123 needs the operator's explicit go-ahead.
