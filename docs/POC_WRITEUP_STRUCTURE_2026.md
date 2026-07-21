# POC Writeup Structure 2026 — what the evidence proves, and what it does not

A handoff for anyone writing from this substrate. It began as a writing-shape sketch made before
the evidence existed; it is now a record of what was actually executed, verified, and bounded —
because the gap between those three is where a reviewer's trust is won or lost.

Rewritten after the 2026 round. Every claim below was run, not assumed; where a claim did not
survive checking, the failed version is kept beside it.

## The pattern worth carrying forward

Four defects surfaced in one afternoon, and all four had the same shape: **a tool answered with
confidence about partial knowledge, and nothing errored.**

- A record parser read markup the way the fixture wrote it, not the way a server sends it —
  invisible until a real response arrived, because the synthetic data had been modelled on the
  parser's expectations.
- A language server answered a query about a document it had never been told about, resolving the
  position against an empty buffer and returning references to unrelated symbols.
- A settle loop accepted "the answer stopped changing" as "the analysis finished", while the
  server repeated the same partial answer throughout indexing.
- A glob matcher treated a pattern it could not parse as a literal, so a configured rule matched
  nothing and said so nowhere.

In two of those, the test double was more forgiving than the thing it stood for, so the suite was
green while the real path was broken.

**This is the strongest argument the writeups can make, and it is not rhetorical.** Executing
against a real system is not a demonstration nicety — it is the only way to find this class of
defect. Say it with the instances, never as a maxim.

## What each theme can claim, and the limit that travels with it

### T1 — governed extensibility (`examples/devbench-t1`)

| Claim | Backed by |
| --- | --- |
| A plugin is reviewed, installed with a SHA-256 stamp, its declared permissions read with risk levels, its identity trusted and its capabilities granted SEPARATELY | The `plugin review → install → permissions → trust → approve` sequence, run end to end |
| Installed and intact is not enough: the extension stays inert until its identity is declared trusted | Observed by trusting only the new plugin and watching the agent stop loading — the mechanism behaving correctly, found by getting it wrong |
| Granting only the two lower-risk permissions leaves the high-risk one absent from the trail | `host-effect:fs:read` present, no `shell:spawn` effect, across a run that used the tool |
| The agent chained tool calls, and the trail holds each call's arguments and the effect it produced | 57 audit records over 10 runs; iterations counted against a declared ceiling of 25 |
| The semantic operation returned the right answer | 2 references — declaration plus cross-file reexport — matching an independent probe of the same server |
| An extension stuck in an infinite loop is interrupted and its neighbour keeps serving | Four runtime proofs, one spinning a real WASM module |
| Extensions compose without referencing each other | 4 extensions, 2 SPI relations, 1 walked in execution — and the graph marks which |

Limits that must appear: local pilot; not a production platform; not a vulnerability scanner; the
scorecard total covers only the criteria the run exercised, and one is reported unexercised.

### T2 — citizen wallet (`examples/wallet-t2`)

| Claim | Backed by |
| --- | --- |
| A request without purpose, scope or expiry is refused, and the refusal names what is missing | Run against the CLI |
| A receipt whose scope grew after issuance is refused, naming `signature` and NOT `not-revoked` | Scope widened from `nome,documento` to include `dados_bancarios`, original proof kept |
| After revocation the refusal names `not-revoked` as well | Same journey, post-revoke |
| Local-first is behaviour, not an adjective: the whole journey runs with the network removed | `fetch` replaced by a throw; journey completed |

Limits: fictional data; local plaintext persistence; the receipt proof algorithm identifies itself
as a demonstration one; no compliance certification.

Lead with the property, not the refusal: **a refusal says which check caught it.** An opaque no is
indistinguishable from an arbitrary one to whoever receives it.

### T3 — requirements bench (`examples/reqbench-t3`)

| Claim | Backed by |
| --- | --- |
| The live path reaches a real institutional ALM: federated auth, application session, one requirement retrieved with identifier, title and body intact | Executed — prerequisites in `docs/writeup-captures.md` |
| Scale holds: 42 folders, 647 artifacts, 624 typed as requirement, 2,557 relations, 100% coverage | A prior controlled extraction, SEPARATE from the PoC and stated as such |
| An outside JSON-LD processor reads the records and resolves their declared types | Reference processor; expansion asserted in `src/jsonld-interop.test.ts` |

Limits: small synthetic corpus in the PoC itself; single-artifact live pull with no project
discovery; the revision chain is not cryptographic; **expansion proves form, not coverage** — the
context declares `@vocab`, so an undeclared term resolves too.

That last one is the method example worth studying. The first assertion written was "every term
resolves to an IRI". It passed, and it was vacuous. The control test — expanding a term nobody
declared — is what exposed it.

## Reproducing the evidence

- Capture packet, brand-neutral at generation: `DGK_COMMAND=poc pnpm run writeup:captures`
- Agent runtime record including a tool-using run: `docs/writeup-captures.md`, section "Registro
  COM chamada de ferramenta". Three things must hold, none automatic: the plugin installed AND
  authorized, a language server present and pointed at, and a prompt carrying the exact position.
- Live institutional pull: `examples/reqbench-t3/README.md`, "Running live". Real URLs never enter
  version control.

## Writing posture

Lead with what ran. Attach the limit in the same sentence rather than in a later caveat section —
a limit that arrives late reads as a retraction. Prefer the specific number to the adjective, and
prefer the failure that was caught to the success that was expected: a trail recording only the
happy path is a showcase, and reviewers know it.

Never let the framework's name reach a delivered artifact. The examples are white-label
(`DGK_COMMAND`), the capture packet neutralizes at generation, and a language gate checks figure
labels for promotional wording — but a screenshot of a terminal is binary, and no gate reads it.
