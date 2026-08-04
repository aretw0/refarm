# Unmet Contract Promises (the lane that stretches the rope)

> A living work-lane, matching `docs/CONVERGENCE-LANE.md`'s discipline: small atomic passes, each
> independently valuable and independently abandonable, each leaving durable material. Companion to
> the triage at `.superpowers/sdd/2026-08-03-budget-laboratory/TRIAGE-promessas.md` and the
> reachability ratchet at `scripts/ci/contract-reachability-baseline.json` (16 entries, opened by
> `docs/superpowers/specs/2026-08-04-instruments-for-the-four-shapes-design.md`'s D1).

## The reframe

The triage recommended REMOVE for ten of the sixteen fields, on the grounds that nothing in
`packages/` or `apps/` consumes them. The maintainer rejected that:

> "não quero falhar em silêncio, mas não vou remover, quero lane de trabalho para todos pois temos
> muitos apps e exemplos para esticar a corda a vontade"

The triage measured "no consumer" against production code and structurally could not see the other
half of the repository: `examples/`, `validations/`, `apps/`. The reachability gate's own scan
scope is `packages/*-contract-v1/src/types.ts` plus `packages/tractor/src/` (stated in the baseline
file's own note); `examples/` never enters it. This lane's job is to give every one of the sixteen a
real consumer that proves it, order the work honestly, and price what does not fit for free.

**One entry below (`vault-contract-v1:VaultSearchHit.score`) turns out to already have a real
consumer.** `examples/reqbench-t3` reads and sorts by it today. The gate cannot see it because it
does not scan `examples/`. That is not a coincidence this lane discovered by luck; it is the shape
the maintainer named before any file was reopened.

## How to read each entry

Every entry carries, in order:

1. **The promise.** What the field claims, and what a consumer gets today instead.
2. **The consumer.** Named, and why that one; or, when the honest answer is that nothing existing
   fits, said plainly, with the smallest real addition proposed instead of a forced fit.
3. **The implementation.** Which file produces the value, which file consumes it, and roughly how
   much work, carrying forward the triage's own costing where it still holds and correcting it where
   closer reading changed it.
4. **What "no longer failing silently" means.** Testable. A field is done when a consumer exercising
   it gets the promised behaviour, and, where it applies, asking for something unsupported produces
   an error instead of silence.
5. **Baseline entry.** The id in `scripts/ci/contract-reachability-baseline.json` this closes.

## Governance corrections found while verifying the consumer map

The task brief's consumer map was a starting hypothesis, not ground truth, and five of its pointers
did not survive a direct read. Recorded here once, referenced by entry:

- **`examples/notesbox-app` does not exist.** Removed in `df45d6cc` ("chore(examples): remove
  notesbox app", 2026-07-07). Only a stray, untracked `node_modules/` directory remains locally; `git
  ls-files examples/notesbox-app` returns nothing.
- **`validations/governed-note-box-poc` has no `package.json`.** It is not a real pnpm workspace
  member (`pnpm-workspace.yaml`'s `validations/*` glob needs one to bind a package) and imports
  neither `provenance-contract-v1` nor any `@refarm.dev/*` package. Its own "provenance" object
  (`governed-note-box-poc.mjs:528-536`: `runId`/`producer`/`command`/`process`/`source`/
  `sourceVersion`/`producedAt`) is a different shape entirely, closer to `ArtifactProvenance` than to
  `NoteProvenance`.
- **`examples/devbench-t1` does not depend on `source-web` or `source-contract-v1` at all.** Its full
  dependency list (`asset-resolver-contract-v1`, `barn`, `capabilities`,
  `capability-homestead-surface`, `capability-host`, `ds`, `homestead`, `plugin-manifest`,
  `quality-checker-ref`, `surface-terminal`, `surveyor`) contains neither.
- **Neither `examples/multi-surface-plugin` nor `examples/third-party-plugin` touches
  `skill-contract-v1`.** `grep -rln "skill-contract-v1" examples/` returns nothing. multi-surface-plugin
  declares PLUGIN-manifest extension surfaces (`plugin-manifest.json`'s `extensions.surfaces`:
  homestead/asset/automation layers), a different contract from skill-contract-v1's
  `SkillManifestV1`/`SkillSurfaceDeclarationV1` despite the shared word "surface". third-party-plugin's
  `README.md` is a prose walkthrough for `storage-contract-v1`, never executed.
- **No example anywhere imports `storage-contract-v1`, `StorageProvider`, or `StorageQuery`.** Confirmed
  against every example's `package.json` and `src/` tree directly.
- **The opposite correction.** The triage's own illustrative worst-case field,
  `vault-contract-v1:VaultSearchHit.score`, is not actually unconsumed. See entry 3.

## Ordering, and the one fact that decided it

Ordered by what teaches and unblocks the most, then by cost, not by package alphabet.
`credentials-contract-v1:VerifiableCredential.validFrom`/`.validUntil` opens because it is the
cheapest real win available: `withinValidity` already exists, is tested, and is **default-on** in
`packages/wallet/src/credentials.ts:147`'s `DEFAULT_WALLET_VERIFY_POLICY`, which means the wallet is
**already** running a validity check against every credential it verifies, today, and that check
vacuously passes every single time because nothing ever sets a validity window. The knob is already
turned on; only the producer is missing. That is the one fact that decided the order: the cheapest
entry is cheap specifically because production code is already, silently, half-exercising it.

`CredentialProof.verificationMethod` follows immediately: same package, same `verify()` path the
wallet already trusts, and it is a trust-model decision, not a routine backlog item, so it does not
sit undecided while cheaper entries get done first. `VaultSearchHit.score` comes third, ahead of
every other cheap entry, because it is the proof-of-concept for this lane's entire premise: a real
consumer already exists, invisible only to the gate's scan scope. Landing it early establishes, with
evidence rather than assertion, that "examples are the second consumer" is not a hopeful reframing.
It is already true in at least one case. From there the entries run roughly cheap-to-expensive, ending
on the two with no honest example fit (`storage-contract-v1:StorageQuery.createdBefore`,
`skill-contract-v1:SkillSurfaceDeclarationOptions.includeOptionalCapabilities`) and closing on
`credentials-contract-v1:CredentialVerificationPolicy.trustRegistry`, the one entry that is not an
afternoon by any honest accounting.

---

## 1. `credentials-contract-v1:VerifiableCredential.validFrom` / `.validUntil`

**The promise.** The credential's validity window. Today: `isExpired`/`isNotYetValid`
(`packages/credentials-contract-v1/src/reference.ts:92-98`) read `validFrom`/`validUntil` and are
wired into `verifyCredential`'s `withinValidity` check, gated on `policy.validity === "required"`
(`reference.ts:541-548`). `DEFAULT_WALLET_VERIFY_POLICY = { validity: "required" }`
(`packages/wallet/src/credentials.ts:147`) turns this on by default for every wallet verification. No
`VerifiableCredential` construction anywhere in the repo, not `issue()`, not a test, not a wallet
call, ever sets `validFrom` or `validUntil`. The check is on; it has nothing to check.

**The consumer.** `examples/wallet-t2`: `src/trust-registry.test.ts` and the `verify --strict` CLI
path already exercise `verifyCredential`'s full check list end to end through `buildWalletHost`. Today
nothing in that flow proves the wallet ever rejects a validity-expired credential (only the sibling
`expirationDate` gets exercised, and only in `packages/credentials-contract-v1/src/conformance.ts:71-90`).

**The implementation.** `reference.ts`'s `issue()` (lines 184-214) is the repo's one real producer.
Add a default `validFrom: unsigned.issuanceDate` when the caller does not supply one, one line,
mirroring how `expirationDate` already flows from caller intent. Then a new `wallet-t2` test, sibling
to `trust-registry.test.ts`, issues a credential with `validUntil` in the past and asserts `verify
--strict` through `buildWalletHost` rejects it, `withinValidity` failing.

**No longer silent.** Today a credential can carry no validity window and pass `withinValidity`
forever, regardless of age. After this, `issue()` stamps a real `validFrom`, and a credential whose
`validUntil` has passed is rejected by the wallet's own already-default policy, proven by the new
`wallet-t2` test, not by inspection.

**Baseline:** `credentials-contract-v1:VerifiableCredential.validFrom`,
`credentials-contract-v1:VerifiableCredential.validUntil`.

---

## 2. `credentials-contract-v1:CredentialProof.verificationMethod` (a trust-model decision, not a routine entry)

This field is required (not optional) on `CredentialProof`, and three real write paths populate it
honestly: `issue()`'s issuer proof (`reference.ts:210`), its holder proof (`reference.ts:247`), and a
status-list fallback (`reference.ts:425`) each set `verificationMethod: issuer.publicKey` /
`holder.publicKey`. `identity.verify()`, the actual signature check, called at `reference.ts:516-528`
and `:590-596`, never reads `.verificationMethod`. It checks only `result.identity.id !==
credential.issuer` (`reference.ts:523`): "someone whose registered id matches the issuer produced a
valid signature over this payload." It never confirms that the specific KEY the proof claims
(`verificationMethod`) is the key that actually produced the signature. Verification today confirms a
valid signature exists, not that the right key signed it.

**The cheap, real, local close.** `IdentityProvider.verify()`'s return type,
`VerificationResult` (`packages/identity-contract-v1/src/types.ts:22-25`), already carries the full
`identity: Identity` object, and `Identity.publicKey` (`types.ts:12`) is right there. For any
credential whose issuer is an identity the wallet's own `identity.get()` can resolve (true of every
scenario `wallet-t2` exercises today, self-issued or peer-issued within the same identity store), the
fix needs no resolver at all: after `identity.verify()` succeeds, compare
`credential.proof.verificationMethod === result.identity.publicKey`. A mismatch fails
`checks.signature` with a new failure code. A few lines in `verifyCredential`
(`reference.ts`, around line 516-528) and the symmetric spot in `verifyPresentation` (around
`:590-596`).

**The genuinely deferred, priced part.** The self-check above only works because, in this repo's own
reference implementation, `verificationMethod` IS the raw public key and the signer is always a local
identity. A credential issued by a genuine third party, a foreign DID whose key material this
repo's `identity.get()` cannot resolve, needs actual DID resolution: fetch and parse a DID document,
extract the verification method's key material, cache it, decide whether to trust the method at all.
`packages/authorization-contract-v1/src/sovereign-signer.ts:22-24`'s own comment already scopes
exactly this out for v1, for the sibling authorization package's receipts: "needs a
DID/verificationMethod resolver, out of scope for v1." That subsystem exists nowhere in this repo.
Building it (a resolver, a document cache, a trust policy over untrusted DID methods) is a multi-day
design, not a lane entry, and pretending otherwise would be the dishonesty this lane is meant to avoid.

**The consumer.** `examples/wallet-t2`: extend `trust-registry.test.ts`'s `issue()` helper (or add a
sibling) to tamper `proof.verificationMethod` after issuance, swapping in a different, real,
previously-registered identity's public key, and assert `verify --strict` now REJECTS it. Today
nothing reads the field, so it would silently pass.

**The decision to record, not defer by omission.** Implement the local self-check now: it is real,
cheap, and closes the gap for every credential this repo's own identity provider can resolve, which is
every credential `wallet-t2` exercises today. Formally defer third-party DID/verificationMethod
resolution with a dated baseline note citing `sovereign-signer.ts:22-24` as precedent, the same shape
the `*TelemetryEvent` deferrals already use in the baseline file. Do not leave a required field three
real writers populate honestly as silent, undecided debt.

**No longer silent.** Today any string in `proof.verificationMethod` passes verification as long as
the signature and issuer match. After the self-check, a `verificationMethod` that does not match the
resolved signer's actual key is rejected, for every credential whose issuer is local, proven by the
tampered-key `wallet-t2` test. Third-party DID verification remains an explicit, dated, priced
deferral, not a silent gap.

**Baseline:** `credentials-contract-v1:CredentialProof.verificationMethod`.

---

## 3. `vault-contract-v1:VaultSearchHit.score` — CLOSED 2026-08-04, no work needed

**Status: closed by fixing the instrument, not the code.** This entry was never a promise to keep;
it was the gate looking in too few places. The gate's scan was widened to `examples/` and
`validations/` (commit `345d1ea7`), it now sees the consumer described below, and the baseline entry
is gone. Nothing in `vault-contract-v1` changed, because nothing needed to.

It was also the only false positive the widening found: the other twenty-three baseline entries were
re-verified under the larger scan and every one held. Left here in full because the anatomy is worth
keeping — see the header note on how the tool and the question shared one blind spot.

**The promise.** "Higher = more relevant" (`packages/vault-contract-v1/src/types.ts:93`) on a search
hit.

**The correction.** The triage's own illustrative example is wrong on the facts. It states
`searchRecords` has zero production callers and that nobody reads `.score`. But
`examples/reqbench-t3/src/search.ts`'s `createRequirementsSearchCapability`, the real,
CLI-and-HTTP-and-web-wired `requirements-search` verb, calls `searchRecords` at line 113, reads
`hit.score` at line 119 (`(existing?.score ?? 0) + (hit.score ?? 1)`, aggregated per matched record),
and SORTS the results by it at line 129 (`results.sort((a, b) => b.score - a.score)`) before returning
them to whatever called the verb. This is production-shaped code, not a test, exercising the exact
feature the triage said nobody uses. The reachability gate reports the field `unread` only because its
scan scope (`packages/*-contract-v1/src/types.ts` plus `packages/tractor/src/`, per the baseline
file's own note) never includes `examples/`. This is the clearest instance in the whole set of the
reframe's own thesis.

**What remains genuinely unmet.** The promise holds only crudely today. `searchNote`
(`packages/vault-contract-v1/src/reference.ts:119-131`) hardcodes `score: 1` for every hit. The
"contains" matcher only detects a first-index match, never counts occurrences. `search.ts`'s
aggregation differentiates records only by how many separate RULES matched, never by how strongly any
one rule matched.

**The consumer.** `examples/reqbench-t3/src/search.ts`, already real, no new example needed.

**The implementation.** `reference.ts`'s `searchNote` (lines 119-131): replace the hardcoded `score: 1`
with a count of occurrences of `value` in `note.text`, a small, real refinement to the same
"contains"-only matcher, not a new matcher or a redesign.

**No longer silent.** Today two notes that each match once, and a note that mentions the term five
times, rank identically. After the change, `requirements-search "nota fiscal"` in `reqbench-t3` ranks
the five-mention note above the one-mention note, provable by a new assertion on rank order in
`search.ts`'s own tests, or a direct unit test on `searchNote`.

**Also flagged, not this lane's job to fix**: the baseline's `unread` classification for this field is
stale the moment `examples/` counts as a consumer, which the maintainer has now settled that it does.
Whoever owns the reachability gate should decide whether to widen its scan scope to `examples/` or add
an explicit "proven outside scan scope" annotation convention, otherwise this same false negative
recurs on the next field an example already exercises.

**Baseline:** `vault-contract-v1:VaultSearchHit.score`.

---

## 4. `artifact-contract-v1:ArtifactProvenance.inputHashes`

**The promise.** Hashes of the inputs (a notebook or dataset source) that fed a produced artifact.
Only the OUTPUT hash (`ArtifactHash` on `TaskArtifactReference.hash`) is wired anywhere; the input side
is declared and validated by the type's own runtime checker but never populated.

**The consumer.** `examples/reqbench-t3/src/lab.ts`'s `createRequirementsLabCapability`, the real
`requirements-lab` verb (CLI + HTTP), which already calls `buildLabManifest`/`notebookArtifact`/
`datasetArtifact` (`packages/lab-contract-v1/src/catalog.ts`) and already computes an output hash via
an injected hasher (`hashData`/`hashOutput`, `lab.ts:56-77, 98, 120, 131-134`).

**The implementation.** `catalog.ts`'s `notebookArtifact`/`datasetArtifact`/`buildLabManifest` (lines
134-250) gain an `inputHashes` option mirroring the existing `hash` option (same optional-spread
pattern already used at lines 157, 181, 230, 241). No new infrastructure: the injectable-hasher pattern
(`HashOutput`, `runner.ts:29`) is precedented right beside it. `examples/reqbench-t3/src/lab.ts` then
hashes the notebook source (`lab/analise-grafo.py`) before export, using the same
`hashData`/Web-Crypto-default pattern already used for the dataset (`lab.ts:56-61, 98`), and passes the
result as `inputHashes` on the notebook's `TaskArtifactReference`.

**No longer silent.** Today the manifest states that an output was produced but never from what. After
this, `requirements-lab --export`'s manifest lets a consumer verify the exported HTML actually came
from the checked-in `lab/analise-grafo.py` at a specific content hash, testable by asserting the
manifest artifact's `provenance.inputHashes` matches a direct hash of the source file.

**Baseline:** `artifact-contract-v1:ArtifactProvenance.inputHashes`.

---

## 5. `task-contract-v1:TaskFilter.created_after_ns` / `.created_before_ns` / `.due_before_ns`

**The promise.** Time-window task filtering. The in-memory adapter
(`packages/task-contract-v1/src/in-memory.ts:136-155`) filters on all three; the SQLite adapter's
`applyTaskFilter` (`packages/storage-sqlite/src/task-v1.adapter.ts:74-96`) silently ignores all three.
The same `TaskFilter` object behaves differently depending on which adapter happens to be configured,
with no error either way. This is the triage's own finding, and the sharpest of the sixteen.

**Correction to the triage's costing.** `applyTaskFilter` operates over already-parsed `Task[]` in
memory. `storage-sqlite` stores tasks as JSON payloads via `StorageProvider`, not SQL columns
(confirmed at `task-v1.adapter.ts:45-52`'s `parsePayload`/`asTask`). The SQLite-side fix is not a SQL
predicate; it is three more `if` blocks, identical in shape to `in-memory.ts:136-147`. This is cheap,
not the "two gaps, high cost" the triage estimated. The genuinely separate gap is the consumer: nobody
anywhere constructs a `TaskFilter` with any of the three fields set, and `apps/refarm/src/commands/
tasks.ts` has zero date-range flags, though that command talks to the sidecar over HTTP, not to
either adapter directly, so a CLI surface there is a larger, separate change this entry does not price.

**The consumer.** `examples/reqbench-t3/src/workitem-task.test.ts` already imports
`createInMemoryTaskAdapter` and builds real `Task`s from rcdc5's CCM work-item shape
(`ccmWorkItemToTask`/`ccmWorkItemToProvenance`, lines 79-98). Add `@refarm.dev/storage-sqlite` as a
`reqbench-t3` devDependency (a small, real, new addition, not free) and add a parity test: build the
same set of tasks with staggered `created_at_ns`, run the identical `TaskFilter` (e.g.
`{created_after_ns: X}`) through BOTH `createInMemoryTaskAdapter` and `createTaskV1StorageAdapter`,
assert identical results. This is the exact "silently inconsistent across adapters" shape the triage
names, proven the way this repo already proves cross-adapter parity elsewhere (`wallet-t2`'s
trust-registry test proves the CLI path; `reqbench-t3`'s own `rcdc5-enrichment.parity.test.ts` proves
byte-identical output against an external oracle).

**The implementation.** Mirror `in-memory.ts:136-147`'s three `if` blocks into `applyTaskFilter`
(`task-v1.adapter.ts:74-96`), cheap. The parity test in `reqbench-t3` is the real work: staging
fixture tasks with distinct `created_at_ns`/`due_at_ns`, running both adapters, asserting the result
sets match.

**No longer silent.** Today the same filter returns different results depending on which adapter is
configured, with no warning either way. After this, both adapters agree, proven by one parity test
running the identical filter against both.

**Baseline:** `task-contract-v1:TaskFilter.created_after_ns`, `.created_before_ns`, `.due_before_ns`.

---

## 6. `authorization-contract-v1:SelectivePresentation.presentedAt`

**The promise.** When a selective disclosure happened. Set for real by `present()`
(`packages/authorization-contract-v1/src/reference.ts:108`) and passed wholesale to the wallet's JSON
envelope (`packages/wallet/src/authorization.ts:351-360`). But no presentation is ever PERSISTED:
only `authorize`/`revoke` write wallet records via `mergeRecords`/`saveManifest`
(`authorization.ts:301, 423`); `present()` computes and returns, nothing stores it. There is no
durable history to read back, which is one level deeper than the triage's costing suggested
("the missing piece is small... a display/audit-log reader"); persistence does not exist yet either.

**The consumer.** `examples/wallet-t2`, the same `present` CLI verb
(`packages/wallet/src/authorization.ts:340-361`) that its own e2e flow already drives.

**The implementation.**
(a) `present()`'s call site in `authorization.ts` persists the returned `SelectivePresentation` as a
wallet record, mirroring the existing `mergeRecords`/`saveManifest` pattern `authorize`/`revoke`
already use, precedented, not new infrastructure.
(b) A new `renderPresentationHistory(presentations: SelectivePresentation[])` in
`packages/authorization-contract-v1/src/render.ts`, mirroring `renderAuthorizationList`/
`renderAuthorizationConsentCard` (`render.ts:148-168, 62-104`), same file, same pattern.
(c) A new `wallet presentations` verb (or a section on the existing `consent`/list surface) in
`packages/wallet/src/authorization.ts` that reads the persisted records back and renders them.
This is real, new work across three files: call it a half-day, not the triage's "low."

**No longer silent.** Today `wallet present` computes a presentation and it is gone the moment the
process exits. After this, `wallet presentations` lists every past disclosure with its real
`presentedAt` timestamp: present once, then list, and see the timestamp; list with nothing presented
yet returns an explicit empty state, not silence.

**Baseline:** `authorization-contract-v1:SelectivePresentation.presentedAt`.

---

## 7. `authorization-contract-v1:ServiceRequest.justification`

**The promise.** A longer human-readable justification beyond the required `purpose`. Genuinely
dormant today: no CLI flag sets it, nothing reads it.

**Correction to the triage's costing.** `pendingRequestToRecord`
(`packages/wallet/src/consent.ts:45-62`) already carries the FULL raw `ServiceRequest` object under
`fields.pendingRequest` (line 59), so `justification` already round-trips through storage the moment a
caller sets it; persistence is not the gap. The gap is narrower than "pure scaffolding" suggests: no
producer (a CLI flag), no reader (the render).

**The consumer.** `examples/wallet-t2`'s `consent` flow, which calls `renderConsentPrompt`
(`packages/wallet/src/consent.ts:184`), a real render already wired to the wallet's web/CLI consent
screen.

**The implementation.** `consent.ts`'s `request` verb (lines 114-121) gains a `--justification` option
mirroring `--purpose`: one line in the options array, one line building the `ServiceRequest`.
`packages/authorization-contract-v1/src/render.ts`'s `renderConsentPrompt` (lines 105-127) gains an
optional paragraph, rendered only when `request.justification` is present, so requests without one
render exactly as they do today.

**No longer silent.** Today a request's `justification`, if a caller ever set it, is silently dropped
from what the citizen sees. After this, a `request --justification "..."` shows that text in the
actual consent prompt an operator or citizen sees before deciding, testable via a `renderConsentPrompt`
case with `justification` set (text present) and one without (section absent, no regression).

**Baseline:** `authorization-contract-v1:ServiceRequest.justification`.

---

## 8. `provenance-contract-v1:NoteProvenance.license` / `.privacy`

**The promise.** Under what license and what publication-privacy posture a note's content may be
used.

**Correction to the consumer map.** `examples/notesbox-app` does not exist (removed `df45d6cc`,
2026-07-07). `validations/governed-note-box-poc` has no `package.json`, imports neither contract
package, and its own "provenance" object is a different shape (`ArtifactProvenance`-like, not
`NoteProvenance`-like). Neither proposed home is real. `examples/reqbench-t3` is the only example
depending on `provenance-contract-v1` at all. Three real (non-test) production sites already call
`stampProvenance` with a `NoteProvenance`-shaped object: `persona.ts:143-153`'s
`parseRequirementsFromHtml` (a real `SourceRecordParser`), `oslc.ts:99-115`, and `fixture.ts:101`. All
three set `channel`/`originLink`/`sourcePath`/`collectedAt`/`contentSha256`, never `license`/
`privacy`. Separately, `workitem-task.test.ts`'s `ccmWorkItemToProvenance` (lines 98-108) already sets
`privacy: "internal"` today (a valid `ProvenancePrivacy` value per `types.ts:24-29`), proving the shape
is exercised, but the test asserts only `.channel`/`.originLink`/an open extra, never `.privacy`, and
never sets `.license` at all.

**The consumer.** `examples/reqbench-t3`'s `parseRequirementsFromHtml`/OSLC ingestion (`persona.ts`,
`oslc.ts`), real production ingestion code stamping provenance for every requirement pulled from an
ALM.

**The implementation.** Set `license` (e.g. "unknown" per the field's own doc comment; the fixture
ALM does not publish one) and `privacy` (e.g. `"internal"`, since these are pulled from an authenticated
corporate ALM, not a public source) in `persona.ts`/`oslc.ts`'s provenance-stamping calls. Reader:
`search.ts`'s results already show facets (`tipo`/`sistema`, `search.ts:43`); extend that to show
license/privacy so an analyst reviewing a requirement before promoting it sees under what terms it may
be used.

**No longer silent.** Today every ingested requirement carries no license/privacy signal at all: the
fields are simply absent, never surfaced. After this, `requirements-search` results show it, and
`workitem-task.test.ts` asserts `.license`/`.privacy` round-trip through `stampProvenance`/
`readProvenance`/`verifyProvenance` (already imported at lines 1-9) the same way `.channel` is asserted
today.

**Deliberately out of scope.** `verifyProvenance`'s check list (`ProvenanceCheckName`,
`types.ts:61-65`) was designed without either field. Adding a `"has-license"`/`"privacy-declared"`
check would be a real feature decision (what should FAIL a note), not a silence-closing fix. This
entry closes producer and reader, not policy.

**Baseline:** `provenance-contract-v1:NoteProvenance.license`, `provenance-contract-v1:NoteProvenance.privacy`.

---

## 9. `source-contract-v1:SourceStatus.lastFetchedAt`

**The promise.** When a materialized source was last fetched. Genuinely computed for real by
`source-web`'s provider (`packages/source-web/src/provider.ts:411`: `provenance?.cache.capturedAt ??
mtime.toISOString()`), never read anywhere.

**Correction to the consumer map.** `examples/devbench-t1` does not depend on `source-web` or
`source-contract-v1` at all (its full dependency list contains neither). `examples/reqbench-t3` is the
only example depending on `source-web`, and it never calls `.status()`:
`ingestSourceToRecords`'s `IngestSourceProvider` interface (`packages/capability-host/src/
ingest-source.ts:8-13`) is deliberately narrow, needing only `materialize()`. `.status()` has no call
site anywhere in `packages/`, `apps/`, or `examples/` today, the deepest "no fit" of the sixteen, since
even the smallest addition needs a genuinely new feature, not wiring an existing call.

**The consumer.** No existing example calls `.status()`. Smallest honest addition:
`examples/reqbench-t3`'s existing `operatorStatus` panel (`cli.ts:291-318`, already a real
operator-facing status surface, today a review-queue unit over records) gains a second unit reporting
source freshness: for each ref declared in `.dgk/sources.json`, call `sourceProvider.status(ref)` and
show `.lastFetchedAt`, or "never fetched" when materialize has not run yet.

**The implementation.** A new unit in `cli.ts`'s `operatorStatus.units` array (alongside the existing
`recordReviewQueueUnit`, lines 300-316), calling the `sourceProvider` already constructed in
`persona.ts` (`createRequirementsSourceProvider`, lines 210-224) for each declared source ref. A real,
if modest, new feature, not a one-line wiring fix. Half a day.

**No longer silent.** Today `dgk requirements`'s operator status panel says nothing about source
freshness even when a source has never been pulled. After this, the panel names each declared source
and its last-fetched time, or explicitly says "never fetched", testable via a status-panel case with
a materialized vs. a never-materialized source ref.

**Baseline:** `source-contract-v1:SourceStatus.lastFetchedAt`.

---

## 10. `storage-contract-v1:StorageQuery.createdBefore` (no example fits, said plainly)

**The promise.** Records created before an ISO timestamp, the mirror of `createdAfter`. Both real
providers (`storage-fs`, `storage-memory`) already filter on it correctly; nobody constructs a query
with either field set.

**The honest gap.** No example anywhere imports `storage-contract-v1`, `StorageProvider`, or
`StorageQuery` (checked every example's `package.json` and `src/` tree; only
`examples/third-party-plugin/README.md` mentions `StorageQuery`, in prose, never executed).
Credentials/tasks all sit on top of storage through their OWN typed filters
(`CredentialsListFilter`, `TaskFilter` — each a separate entry above), none of which forwards a date
range down to the underlying `StorageQuery`. Forcing this into an example today means inventing a new
time-windowed storage consumer from nothing, not exercising one that almost fits — exactly the case
the brief said to name rather than force.

**The consumer.** None of the sixteen examples. The smallest honest addition stays in `packages/`:
`packages/storage-fs/src/storage-v1.conformance.test.ts:47`'s own test is already named "filters query
by type and createdAfter/createdBefore" and already sets `createdAfter` (line 78) — its name has
promised `createdBefore` since it was written and its body has never delivered it.

**The implementation.** One assertion added to the existing test, using a second fixture record
outside the `createdBefore` window. Trivial.

**No longer silent.** Today the test's own name promises a behaviour its body does not check. After
this, the test proves `createdBefore` actually works, matching what it already claims.

**Baseline:** `storage-contract-v1:StorageQuery.createdBefore`.

---

## 11. `skill-contract-v1:SkillSurfaceDeclarationOptions.includeOptionalCapabilities` (no example fits, two layers deep)

**The promise.** When true, include a skill manifest's optional capabilities in a built surface
declaration.

**Correction to the consumer map.** Neither `examples/multi-surface-plugin` nor
`examples/third-party-plugin` touches `skill-contract-v1` at all (`grep -rln "skill-contract-v1"
examples/` returns nothing). multi-surface-plugin declares PLUGIN-manifest extension surfaces
(homestead/asset/automation layers) — a different contract entirely, despite the shared word
"surface". third-party-plugin's README is a documentation walkthrough for `storage-contract-v1`. This
is a two-layer gap, confirmed independently of the option itself: `buildSkillSurfaceDeclaration`
(`packages/skill-contract-v1/src/skill-activation.ts:27`) — the function this option belongs to — has
zero callers anywhere in `packages/` or `apps/` outside its own conformance suite. The option being
unset is a symptom of the whole function being unused, not the root problem.

**The real, distant relative.** `packages/plugin-surface-loader` already loads "pi"/"skill" extension
surfaces FROM a plugin manifest's `extensions.surfaces` (`loadSkillsFromManifest`,
`plugin-surface-loader/src/index.ts:99`) — but it CONSUMES an already-built
`SkillSurfaceDeclarationV1`-shaped entry; it never calls `buildSkillSurfaceDeclaration` to PRODUCE
one. That function is the missing authoring-time step: turning a parsed `SkillManifestV1` into the
`extensions.surfaces` entry a plugin manifest ships.

**The consumer.** No existing example fits. Smallest honest addition: a new round-trip test/script in
`examples/multi-surface-plugin` (or a new minimal example, if that one's manifest shape is too
committed to non-skill surfaces) that parses a real `SKILL.md` fixture with one required and one
optional capability via `parseSkillMarkdown`, builds its surface declaration via
`buildSkillSurfaceDeclaration({ assetPath, includeOptionalCapabilities: true })` and again with
`false`/absent, asserts the built `capabilities` array includes the optional one only in the first
case, then feeds the built declaration into `loadSkillsFromManifest` to prove the authored surface
actually loads. This closes both gaps in one pass: `buildSkillSurfaceDeclaration` gets a real caller,
and the flag is exercised both ways.

**The implementation.** The round-trip script/test itself — no changes needed to `skill-contract-v1`
or `plugin-surface-loader`, both already do what is needed, they have simply never been chained
together. Half a day, mostly in writing the minimal `SKILL.md` fixture.

**No longer silent.** Today nothing in this repo ever builds a surface declaration from a skill
manifest, so the flag's effect has never been observed. After this, the round-trip test shows the
declared capability set growing by exactly the optional ones when the flag is true, and staying at
just the required ones when it is false or absent.

**Baseline:** `skill-contract-v1:SkillSurfaceDeclarationOptions.includeOptionalCapabilities`.

---

## 12. `credentials-contract-v1:CredentialVerificationPolicy.trustRegistry` (the expensive one, closing this lane)

**The promise.** A reference to an EXTERNAL trust registry to consult when deciding if an issuer is
trusted, as an alternative to the explicit `trustedIssuers` allowlist. `verifyIssuerTrust`
(`packages/credentials-contract-v1/src/reference.ts:619-638`) checks only `policy.trustedIssuers`/
`policy.trustSelf`; `trustRegistry` never enters trust-decision logic anywhere.

**Why this is the expensive one, priced plainly.** Unlike entry 2's `verificationMethod`, there is no
cheap, self-consistent, local version of this promise — a trust registry is definitionally an
external, possibly remote, possibly third-party-operated list, and this repo has never fetched,
parsed, cached, or reasoned about trusting one. `examples/wallet-t2`'s `trust-registry.test.ts`, its
name notwithstanding, tests `resolveVerifyPolicyFromEnv` parsing `DGK_TRUSTED_ISSUERS` into the
EXISTING `trustedIssuers` allowlist — a real, working, but entirely different mechanism (a
locally-declared allowlist, not a remotely-consulted registry). The real thing needs: a fetch or read
of a registry document at verify time or on a refresh cadence, a defined document shape this repo has
never designed, an offline/cache story (verification cannot require network by default — `wallet-t2`'s
own tests run offline), and a decision about how a registry's trust interacts with the existing
`trustedIssuers`/`trustSelf` (additive, or overriding). None of that exists today, at any layer.

**The smallest honest real version.** Not the full federation-capable thing — treat
`trustRegistry.uri` as a local/cached JSON document (a flat array of trusted issuer DIDs, the simplest
shape that satisfies "a trust registry" without inventing a protocol), fetched once and cached by the
CALLER, mirroring the injection discipline this repo already uses throughout (`HashOutput`,
`ProcessExecutor`, and the rest) so `credentials-contract-v1` stays dependency-light. Folded into
`verifyIssuerTrust` as one more source alongside `trustedIssuers`. Still real, scoped work: a document
shape, a fetch/cache boundary, and the trust-check wiring. Price: one to two days, not an afternoon —
a real subsystem even at its smallest honest scope.

**The consumer.** `examples/wallet-t2` — extend the already-misleadingly-named
`trust-registry.test.ts` (or add a sibling) with a real registry-backed scenario: a
`CredentialVerificationPolicy.trustRegistry` pointing at a local JSON fixture listing trusted issuer
DIDs, verifying that an issuer IN the registry passes and one NOT in it fails — the same shape
`trust-registry.test.ts` already proves for `trustedIssuers`, now for the field actually named
`trustRegistry`.

**The implementation.**
(a) A minimal `TrustRegistryDocument` shape plus an injected
`resolveTrustRegistry: (ref: TrustRegistryRef) => Promise<{ trustedIssuers: string[] }>` on the
reference provider (or `verifyIssuerTrust`'s options).
(b) `verifyIssuerTrust` folds the resolved registry's issuers into the trust decision alongside
`trustedIssuers`.
(c) `wallet-t2` wires a real, fs-backed, offline resolver for its own tests and CLI.

**No longer silent.** Today `trustRegistry` on a policy is accepted and silently ignored — a verifier
who believes they pinned a registry has pinned nothing. After this, a credential from an issuer absent
from the resolved registry is rejected the same way an issuer absent from `trustedIssuers` is today —
proven by the new `wallet-t2` scenario.

**Baseline:** `credentials-contract-v1:CredentialVerificationPolicy.trustRegistry`.

---

## How to resume

Twelve entries cover all sixteen baseline ids (three carry more than one field, where the
implementation and consumer are identical: entry 1 closes two, entry 5 closes three, entry 8 closes
two). Take one entry at a time, smallest atomic pass per the ant-journey method in
`docs/CONVERGENCE-LANE.md`: implement, prove it with the named consumer, delete the entry's baseline
id(s) from `scripts/ci/contract-reachability-baseline.json` in the same commit (the gate shrinking is
this lane's own progress bar), update this doc to move the entry to a dated "Done" note. No entry
depends on another — take them in any order once the field's own prerequisites (a new devDependency,
a new small fixture) are in hand; the order above is a recommendation about teaching value and cost,
not a sequencing requirement.

Entry 2 and entry 12 are not ordinary backlog items — each closes with an explicit decision (build the
narrow real thing, defer the wide one by name) rather than an implementation checklist alone. Do not
let either sit half-read; the deferred half of each needs its own dated baseline note the day the
narrow half ships, or the "decided, not silent" claim this lane makes about them stops being true.
