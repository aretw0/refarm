# Iroh 1.0 as a distributed transport candidate

**Date:** 2026-08-02  
**Status:** Research verdict — candidate for a contained validation, not adopted  
**Decision context:** [ADR-075](../../specs/ADRs/ADR-075-pears-distributed-runtime-reference.md)  
**Evidence rule:** facts below come from Iroh's official documentation, release posts, and
repositories. Refarm translations and recommendations are explicitly marked as inference.

## Question

Does Iroh 1.0 turn the distributed-availability direction recorded from Pears/Holepunch into a
concrete transport candidate for Refarm, without replacing Tractor, Loro, the authorization model,
or the current Tailnet-backed operator journeys?

## Verdict

**Study more by building one private validation. Do not integrate Iroh into the runtime yet.**

Iroh 1.0 materially changes the evidence. The project now commits to stable 1.x wire and language
APIs, and its narrow center — encrypted QUIC connections addressed by an Ed25519 `EndpointId`,
with address lookup, NAT traversal, relay fallback, and ALPN-routed protocols — fits beneath
Refarm's existing contracts instead of competing with them.

The strongest first fit is **artifact availability and transfer between native nodes**. It is not
remote operation execution, replicated configuration, browser sync, or authorization. A validation
should carry an already-produced Refarm artifact descriptor and prove fetch, integrity, refusal,
reachability, and provider availability. If that proof cannot remain ignorant of plugins, npm,
workspaces, and app vocabulary, the boundary is wrong.

Pears and Iroh teach different layers:

| Reference | What it is useful for | What Refarm should not infer |
| --- | --- | --- |
| Pears/Holepunch | whole-platform shape: portable core, thin hosts, code/data distribution, release and blind availability | that Refarm should adopt Bare or the Hypercore family |
| Iroh 1.x | a concrete native connection substrate and composable protocol ecosystem | that connectivity supplies authorization, durable availability, or product semantics |
| Refarm | declared authority, artifacts, release evidence, operations, plugins, surfaces, and operator consent | that one transport should become the framework contract |

## Factual substrate

### Stable center

- Iroh 1.0 was announced on 2026-06-15. The release asserts compatibility between 1.x endpoints
  across minor versions for both the wire protocol and language APIs. Wire-breaking changes are
  reserved for a major release.
- The core is a Rust library, licensed MIT or Apache-2.0. An endpoint has an Ed25519 identity and
  establishes end-to-end encrypted QUIC connections.
- A `Router` dispatches multiple protocols sharing one endpoint by ALPN. Protocols remain separate
  crates; applications may use existing protocols or define their own.
- Iroh attempts direct connections and falls back to a relay when NAT traversal cannot establish a
  direct path.

**Inference for Refarm:** this is compatible with Tractor's native ownership and with versioned,
package-owned wires. Iroh belongs below an availability or transport contract, not above it.

### Discovery and identity

- An `EndpointId` is stable identity, not sufficient dialing information by itself. Address lookup
  resolves current direct addresses and relay URLs.
- Without address lookup, applications must carry an `EndpointAddr`; those dialing details can go
  stale. Iroh recommends persisting only `EndpointId` when discovery is configured.
- Tickets combine endpoint address information with optional application data. They are reusable,
  may expose IP addresses, can go stale, and may act as capabilities when an application embeds a
  secret or write authority.

**Inference for Refarm:** endpoint identity may become one identity source or peer reference, but it
must not silently become a Refarm principal, credential, or authorization grant. Enrollment must
bind a reviewed endpoint identity to existing policy. Tickets require the same one-time-display,
redaction, expiry, and consent discipline as current device credentials.

### Relays and sovereignty

- Public relays are explicitly positioned for development and hobby use: no SLA, rate limits, and
  no version locking guarantee beyond the support posture published for current releases.
- Relay traffic is end-to-end encrypted, but relays can observe connection metadata such as peer IP
  addresses, times, and transferred volume. The documentation advises against public relays for
  sensitive or confidential data.
- Production guidance recommends dedicated relays. The relay is open source and stateless, and can
  be self-hosted; that still requires public infrastructure, DNS/TLS, upgrades, and monitoring.
- Iroh 1.0.2 fixed a pre-authentication denial-of-service in the relay parser that allowed a
  malformed frame to crash a relay. Public relays were patched and parser fuzzing was added.

**Inference for Refarm:** public relay use is acceptable only for non-sensitive validation
fixtures. “Self-hostable” is not “zero operations.” Tailnet remains the correct in-house rail while
this PC is policy-constrained; Iroh must earn a place as an alternative profile, never be required.

### Protocols relevant to Refarm

| Iroh protocol | Fact | Refarm interpretation |
| --- | --- | --- |
| raw QUIC streams | ordered, backpressured streams over an authenticated connection | candidate carrier for an existing Refarm wire |
| `iroh-blobs` | BLAKE3-addressed, verified, resumable blob/range transfer; tags control local garbage collection | strongest candidate for artifact availability; it does not define release trust or retention policy |
| `iroh-gossip` | epidemic broadcast trees for topic subscribers | possible later liveness/announcement rail; not a source of truth or command bus |
| `iroh-docs` | metadata reconciliation over blobs plus gossip notifications | do not adopt while Loro/SQLite owns Refarm convergence; compare only if a real missing invariant appears |

`iroh-blobs` proves bytes received match its BLAKE3 root. Refarm artifacts currently own their own
identity and integrity evidence. A proof should retain the Refarm digest and record the Iroh hash as
transport evidence; it must not rewrite the public artifact identity merely to fit the transport.

### Platform reality

- The official compatibility matrix names Linux, Android, iOS, Windows, macOS, WebAssembly, and
  constrained devices.
- First-party Swift, Kotlin, Python, and JavaScript bindings were announced immediately after 1.0,
  but currently expose the core stream API; blobs, gossip, documents, mDNS, and Bluetooth are named
  as future binding work.
- The browser documentation is not a sufficient parity claim for Refarm's PWA. Official material
  says browser operation exists while also stating that browser hole punching is unavailable and
  WebRTC remains the default for that case.
- Custom transports such as BLE and Tor are explicitly unstable; BLE also carries separate AGPL or
  commercial licensing. They are not part of this candidate decision.

**Inference for Refarm:** the first validation must be Rust/native. The current zero-dependency
Termux kit and PWA cannot be promised an Iroh transport from the 1.0 core evidence. Android may
later consume a native/Kotlin endpoint, but that is a separate packaging and lifecycle proof.

## Fit against the current Refarm substrate

| Concern | Existing authority | Possible Iroh role | Boundary |
| --- | --- | --- | --- |
| artifact identity/provenance | `artifact-contract-v1`, release evidence | verified byte transport | Iroh hash is transport evidence, not release identity |
| availability policy | distributed-availability evidence validation | provider/requester reachability | a provider being online is not a blind-replica policy |
| peer identity | identity/auth policy and device enrollment | stable `EndpointId` | identity does not imply authority |
| remote operations | declared `/operations` catalog and result wires | possible future carrier | no generic shell and no Iroh-specific executor |
| sync | Loro/SQLite and sync contracts | possible transport adapter | do not introduce `iroh-docs` as a second state model |
| discovery | Tailnet/LAN and declared surfaces | optional address-lookup adapter | no mandatory n0 public discovery |
| process lifecycle | declared processes and host supervisor | keep a native endpoint alive | no hidden daemon lifecycle |
| diagnostics | health, hardening, diagnostic bundles | path/relay/direct-rate evidence | sanitize endpoint/IP metadata before export |

## Proposed validation: `iroh-distributed-availability`

The experiment belongs under `validations/`, remains private, and creates no publishable package.
It should use the newest patched 1.0.x release, pinned through the Rust lockfile and normal supply
policy.

### Phase A — loopback boundary

1. Start two ephemeral endpoints with explicit fixture identities.
2. Register one versioned ALPN owned by the validation, not by the Refarm app.
3. Produce a small artifact through the existing descriptor/evidence path.
4. Transfer it using `iroh-blobs` or a minimal framed stream.
5. Verify both the transport hash and the original Refarm artifact digest.
6. Emit a bounded observation:
   `available | fetched | verified | refused | unreachable`.

Pass condition: neither side imports app, plugin, workspace, CLI, or Tailnet vocabulary.

### Phase B — availability, not merely transfer

1. Stop the primary provider and prove the artifact becomes unavailable.
2. Add an explicit replica fixture and prove it remains available.
3. Remove the replica's retention grant/tag and prove availability disappears predictably.
4. Record which peer asserted availability, for how long, and against which artifact digest.

Pass condition: the result can feed the existing distributed-availability evidence without making
Iroh a required field in that evidence.

### Phase C — real network and sovereignty profiles

1. Run across two operator-owned native nodes on LAN/Tailnet-independent networking.
2. Measure direct versus relayed connection, setup time, reconnect behavior, and resource cost.
3. Use public discovery/relay only with synthetic data and record the metadata disclosure.
4. Repeat with public infrastructure disabled or with an explicitly configured relay/discovery
   profile before making any sovereignty claim.

Phase C is operator-gated because it changes network exposure and may require infrastructure.

### Kill criteria

Stop adoption and retain only the research if any of these are true:

- the adapter cannot remain optional beneath a transport-neutral Refarm contract;
- reliable operation requires public n0 infrastructure with no acceptable self-owned profile;
- Android/Termux packaging cost outweighs the failure modes removed from the current Tailnet rail;
- artifact identity must be rewritten around BLAKE3 instead of carried independently;
- the runtime gains a second authorization or replicated-state model;
- memory, binary size, build time, or idle network cost violates the host/device ceilings;
- the proof solves no dogfood or second-consumer problem beyond “P2P is interesting.”

## Decision ladder

1. **Now:** retain Tailnet for the in-house operator path; finish Telegram over existing operation
   contracts.
2. **Next independent research slice:** implement Phase A only, in `validations/`, when a clean Rust
   lane is available.
3. **Promote to transport adapter:** only after Phase B and one real consumer need artifact
   availability without a shared filesystem/registry.
4. **Promote to runtime rail:** only after Phase C, native-device packaging, auth binding,
   diagnostics, process supervision, and rollback are proven.
5. **Never by implication:** `iroh-docs`, gossip-based commands, public-relay production, and
   endpoint-key-as-authority each require their own decision.

## Source ledger

Accessed 2026-08-02:

- Iroh 1.0 announcement and stability promise: <https://www.iroh.computer/blog/v1>
- Core repository and licensing: <https://github.com/n0-computer/iroh>
- Architecture overview: <https://docs.iroh.computer/what-is-iroh>
- Endpoints and persistence guidance: <https://docs.iroh.computer/concepts/endpoints>
- Protocol composition and ALPN: <https://docs.iroh.computer/concepts/protocols>
- Tickets and security considerations: <https://docs.iroh.computer/concepts/tickets>
- Blob transfer and storage: <https://docs.iroh.computer/protocols/blobs>
- Documents stack: <https://docs.iroh.computer/protocols/documents>
- Platform compatibility: <https://docs.iroh.computer/compatibility>
- First-party language bindings: <https://www.iroh.computer/blog/iroh-language-support>
- NAT traversal: <https://docs.iroh.computer/concepts/nat-traversal>
- Public-relay policy: <https://docs.iroh.computer/iroh-services/relays/public>
- Dedicated/self-hosted relay guidance: <https://docs.iroh.computer/add-a-relay>
- Deployment security and privacy: <https://docs.iroh.computer/deployment/security-privacy>
- Relay vulnerability fixed in 1.0.2: <https://www.iroh.computer/blog/iroh-1-0-2>
- Diagnostics: <https://docs.iroh.computer/troubleshooting>

## Revisit triggers

- a second native Refarm node needs artifacts without npm, Git, shared storage, or Tailnet;
- the in-house node moves to infrastructure where a self-owned relay/discovery profile is viable;
- Iroh bindings expose stable blobs or protocol routing on Android/JavaScript;
- PWA/browser connectivity claims become precise enough to test against the native path;
- the distributed-availability proof needs a real provider/replica transport;
- a downstream Refarm-compatible app asks for the same transport adapter.
