# consumer-ready handoff

Directory: `.refarm/handoff/vault-seed/2026-08-29`
Status: ok
Acceptance: accepted (24 package(s), 76 required check(s))

| Package | Tarball | SHA256 | Consumer proof |
| --- | --- | --- | --- |
| `@refarm.dev/storage-contract-v1` | `refarm.dev-storage-contract-v1-0.1.0.tgz` | `a6b5a77db4da11e812d3a913499812aaf2751cda51c1a1b802166db28f2d0dcd` | a consumer vendors storage-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present -> wallet |
| `@refarm.dev/identity-contract-v1` | `refarm.dev-identity-contract-v1-0.1.0.tgz` | `951f67145ea5a420abd3aacdca5b3e7b2b5982dc0832e9bf2655877d28816d87` | a consumer vendors identity-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present |
| `@refarm.dev/artifact-contract-v1` | `refarm.dev-artifact-contract-v1-0.1.0.tgz` | `686f49b96ad046b0c4a4e146b941e80a117da8173ffb7f4f60c94910a77ece83` | a consumer emits refarm.task-artifacts.v1 manifests from Lab/outbox/notebook producers |
| `@refarm.dev/channel-policy-v1` | `refarm.dev-channel-policy-v1-0.1.0.tgz` | `72ee95f6d2717510116642e33d994716418ffbec29a6e35180a849820218c88d` | a consumer's Telegram adapter emits refarm.channel-delivery-envelope.v1 |
| `@refarm.dev/effort-contract-v1` | `refarm.dev-effort-contract-v1-0.1.0.tgz` | `5633abcd6141f437b5df19cd4b1f49811439803c3e82f78a755c61e21a0c20d8` | a consumer's process flows attach effort identifiers to emitted evidence |
| `@refarm.dev/quality-contract-v1` | `refarm.dev-quality-contract-v1-0.1.0.tgz` | `2a77254588670060a6025b87906f3e159335fdec745817ab0767686ecdaac97b` | a consumer and agent-demo POCs can declare quality intentions through quality:v1 while keeping domain profiles downstream-owned |
| `@refarm.dev/source-contract-v1` | `refarm.dev-source-contract-v1-0.1.0.tgz` | `10c33c815def0120e83fae2dc9348db4f09e5acb7756ac16469da8d9063c78a8` | a consumer vendors source-contract-v1 as the source-web transitive override while proving source-web -> records:v1 -> enrichment:v1 composition |
| `@refarm.dev/enrichment-contract-v1` | `refarm.dev-enrichment-contract-v1-0.1.0.tgz` | `93ead2e100d5d6d930d4e91ee5ce9fdbd638a7f4aa05e4b457ad6427d8922bea` | a consumer emits enrichment:v1 reports from checkout-owned providers while the package supplies only the neutral contract and fixture provider |
| `@refarm.dev/records-contract-v1` | `refarm.dev-records-contract-v1-0.1.0.tgz` | `3355f5026397d4fb55f60ba964ae347a442730d8ae279a501f09d8058a419686` | a consumer validates requirement-like records and notes-to-records projections through records:v1 with a clean reference-vault composition proof |
| `@refarm.dev/process-handoff` | `refarm.dev-process-handoff-0.1.0.tgz` | `6a08b77ca2113cc278fa15762383e62eda396b6413934fb392e546bcf38f06f7` | a consumer's runner keeps run(cmd, args, opts) while using process-handoff internally |
| `@refarm.dev/health` | `refarm.dev-health-0.1.0.tgz` | `f8d8c9673f5b202437b75089edd9bd8f9d4927961712248fb73d461e20e22872` | a consumer can replace dgk check-substrate internals with ToolchainAuditor while keeping dgk doctor UX and recovery copy downstream |
| `@refarm.dev/release-engine` | `refarm.dev-release-engine-0.1.0.tgz` | `ba7394c329da27631bca97893b1815fd0308f4abd2643466138fe8acc507965b` | a consumer's release/package smoke consumes release-engine acceptance output |
| `@refarm.dev/heartwood` | `refarm.dev-heartwood-0.1.0.tgz` | `99f07aae42a770faff1f503b22db07a5dcf518637d0aa08b68e84ab738e55f07` | a consumer's credential flow uses silo without local crypto stand-ins |
| `@refarm.dev/silo` | `refarm.dev-silo-0.1.0.tgz` | `1db4ef12df95c0cad4f6766ca73b31ab2b656df61121f0e1522e8ee17082407c` | a consumer stores model/runtime/publishing credentials through silo namespaces |
| `@refarm.dev/storage-memory` | `refarm.dev-storage-memory-0.1.0.tgz` | `0da13f60be1852bc20cc79559d3e00c4f552ea10e3fd9893f2609bb7b39424be` | sovereign-citizen:reference:test stores and lists the issued credential through storage-memory |
| `@refarm.dev/credentials-contract-v1` | `refarm.dev-credentials-contract-v1-0.1.0.tgz` | `18f3b0e79e4204d98e845a7b30ecfe9672966d614eaba2cb028e30bb10331d39` | a consumer vendors credentials-contract-v1 early and proves issuer/verifier/wallet seams with trustedIssuers, trustSelf, holder-binding, and local signed status-list revocation checks before headspace UX |
| `@refarm.dev/dispatch-surface` | `refarm.dev-dispatch-surface-0.1.0.tgz` | `c68225e06b9298b838dc2d0f00474e33bfece9202dae3420d7bb169e2a6460d0` | Consumers route channel/transport dispatch operations through these shared primitives. This is NOT a product-command/CLI registry — product commands stay in the consumer command layer (the old wording wrongly suggested modeling CLI commands on it). |
| `@refarm.dev/ds` | `refarm.dev-ds-0.1.0.tgz` | `317978d2d2633190b241b2a5bc6e2bec50fbe123b4ad12929983f4062d7ecbc1` | a consumer's Lab/admin UI imports ds tokens and renders documentHtml through @refarm.dev/ds/html without pulling Homestead |
| `@refarm.dev/source-web` | `refarm.dev-source-web-0.1.0.tgz` | `a0484881937d26ff836a8cbfa0f2ae32927c9954fb5bf622a635b6b9be4b17a2` | a consumer wraps source-web with real checkout-owned source behavior and proves redacted source:v1 snapshots compose into records:v1 and enrichment:v1 |
| `@refarm.dev/vault-contract-v1` | `refarm.dev-vault-contract-v1-0.1.0.tgz` | `b3a712d22578db01df503934f7308d91873accd7271024aa438e70c2ae7e43b7` | a consumer can run vault:v1 corpus health over its own records:v1 projection and surface the findings, while keeping its privacy heuristics, folder policy, and PII vocabulary downstream-owned |
| `@refarm.dev/content-projection` | `refarm.dev-content-projection-0.1.0.tgz` | `16798f31484f21436475290702ca28e047bef27d58641bdf9a9777a3025239c9` | a consumer can replace local note-to-record, wikilink, and inline-link projection helpers with the generic projection block while retaining its product configuration |
| `@refarm.dev/identity-heartwood` | `refarm.dev-identity-heartwood-0.1.0.tgz` | `2f70b2e39375cde797143ab7d2164719dac13d032198951c679bebda0ad714fd` | sovereign-citizen:reference:test proves real Ed25519 issue and present signatures through identity:v1 |
| `@refarm.dev/local-surface` | `refarm.dev-local-surface-0.1.0.tgz` | `19220bd8ac49c9d7050148cd3c5c55f8e6b8c2381adf5164a54dd99b4d7f1f82` | a consumer can build a local-surface:v1 manifest, DS-backed HTML, white-label launch plan, and quality:v1 report while keeping routes, screenshots, provider adapters, and product vocabulary downstream-owned |
| `@refarm.dev/ds-astro` | `refarm.dev-ds-astro-0.1.0.tgz` | `3c0e2da7db80d2440c0d9373eeed7e0d7764dbe84084c7b6315b805e8ca2e062` | a consumer can replace local dgk/vault/astro block packages with @refarm.dev/ds-astro imports while keeping product-specific MDX copy and route semantics downstream |

Consumer proofs:

- `credentials-storage-contract.transitive-wallet-support` / `@refarm.dev/storage-contract-v1`: a consumer vendors storage-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present -> wallet (Durable wallet persistence, retention, encryption policy, and wallet UX remain downstream)
- `credentials-identity-contract.transitive-signature-support` / `@refarm.dev/identity-contract-v1`: a consumer vendors identity-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present (Issuer trust, DID methods, account recovery, and identity UX remain downstream)
- `artifact-contract.lab-outbox-evidence` / `@refarm.dev/artifact-contract-v1`: a consumer emits refarm.task-artifacts.v1 manifests from Lab/outbox/notebook producers (Vault schemas, notebook UX, and frontmatter remain downstream)
- `channel-policy.telegram-delivery-envelope` / `@refarm.dev/channel-policy-v1`: a consumer's Telegram adapter emits refarm.channel-delivery-envelope.v1 (Provider API calls, copy formatting, and inbox/outbox UX remain downstream)
- `effort-contract.dgk-effort-evidence` / `@refarm.dev/effort-contract-v1`: a consumer's process flows attach effort identifiers to emitted evidence (dgk command vocabulary and operator UX remain downstream)
- `quality-contract.declared-lint-envelope` / `@refarm.dev/quality-contract-v1`: a consumer and agent-demo POCs can declare quality intentions through quality:v1 while keeping domain profiles downstream-owned (Rule catalogs, severity policy, product copy, personas, and rendered-subject collection remain downstream)
- `requirements-source-contract.transitive-source-web-support` / `@refarm.dev/source-contract-v1`: a consumer vendors source-contract-v1 as the source-web transitive override while proving source-web -> records:v1 -> enrichment:v1 composition (Concrete login, selectors, and source profile vocabulary remain downstream)
- `requirements-enrichment.private-provider-wrapper` / `@refarm.dev/enrichment-contract-v1`: a consumer emits enrichment:v1 reports from checkout-owned providers while the package supplies only the neutral contract and fixture provider (Private registries, lookup adapters, tag vocabulary, and domain enrichment rules remain downstream)
- `requirements-records.knowledge-manifest` / `@refarm.dev/records-contract-v1`: a consumer validates requirement-like records and notes-to-records projections through records:v1 with a clean reference-vault composition proof (PARA placement, editorial model, note rendering, and domain labels remain downstream)
- `process-handoff.dgk-runner-adapter` / `@refarm.dev/process-handoff`: a consumer's runner keeps run(cmd, args, opts) while using process-handoff internally (dgk package names, binary, commands, and product labels remain downstream)
- `health.toolchain-environment-auditor` / `@refarm.dev/health`: a consumer can replace dgk check-substrate internals with ToolchainAuditor while keeping dgk doctor UX and recovery copy downstream (Project-specific command names, setup recommendations, required file policy, and health+quality composition remain downstream)
- `release-engine.package-acceptance` / `@refarm.dev/release-engine`: a consumer's release/package smoke consumes release-engine acceptance output (Distribution identity, prose, and changelog content remain downstream)
- `heartwood.silo-crypto-substrate` / `@refarm.dev/heartwood`: a consumer's credential flow uses silo without local crypto stand-ins (Credential policy choices and publishing identities remain downstream)
- `silo.credential-namespaces` / `@refarm.dev/silo`: a consumer stores model/runtime/publishing credentials through silo namespaces (Provider-specific publishing adapters and approval workflow remain downstream)
- `credentials-storage-memory.reference-wallet` / `@refarm.dev/storage-memory`: sovereign-citizen:reference:test stores and lists the issued credential through storage-memory (Production durability, synchronization, encryption-at-rest, and wallet UX remain downstream)
- `credentials-contract.issue-verify-present-wallet` / `@refarm.dev/credentials-contract-v1`: a consumer vendors credentials-contract-v1 early and proves issuer/verifier/wallet seams with trustedIssuers, trustSelf, holder-binding, and local signed status-list revocation checks before headspace UX (Issuer authorities, credential schemas, trust registry sources, remote status-list distribution, trust UI, and domain vocabulary remain downstream)
- `dispatch-surface.dgk-descriptor` / `@refarm.dev/dispatch-surface`: Consumers route channel/transport dispatch operations through these shared primitives. This is NOT a product-command/CLI registry — product commands stay in the consumer command layer (the old wording wrongly suggested modeling CLI commands on it). (Surface labels, routes, and product-specific actions remain downstream)
- `ds.lab-admin-static-document` / `@refarm.dev/ds`: a consumer's Lab/admin UI imports ds tokens and renders documentHtml through @refarm.dev/ds/html without pulling Homestead (PARA vocabulary, editorial copy, and content semantics remain downstream)
- `requirements-source-web.authenticated-capture` / `@refarm.dev/source-web`: a consumer wraps source-web with real checkout-owned source behavior and proves redacted source:v1 snapshots compose into records:v1 and enrichment:v1 (Real credentials, discovery, selectors, pacing values, and source-specific ETL profiles remain downstream)
- `vault-contract.corpus-health-over-projected-records` / `@refarm.dev/vault-contract-v1`: a consumer can run vault:v1 corpus health over its own records:v1 projection and surface the findings, while keeping its privacy heuristics, folder policy, and PII vocabulary downstream-owned (Privacy heuristics, PII candidate detection, designated-folder policy, note vocabulary, and surface rendering remain downstream)
- `content-projection.markdown-mdx-records` / `@refarm.dev/content-projection`: a consumer can replace local note-to-record, wikilink, and inline-link projection helpers with the generic projection block while retaining its product configuration (PARA folder mapping, note vocabulary, Obsidian/Foam conventions, and rendering remain downstream)
- `credentials-identity-heartwood.reference-signature` / `@refarm.dev/identity-heartwood`: sovereign-citizen:reference:test proves real Ed25519 issue and present signatures through identity:v1 (Trust registry, default identity provider choice, secret persistence, and DID resolution remain downstream)
- `local-surface.white-label-operator-proof` / `@refarm.dev/local-surface`: a consumer can build a local-surface:v1 manifest, DS-backed HTML, white-label launch plan, and quality:v1 report while keeping routes, screenshots, provider adapters, and product vocabulary downstream-owned (Server binding, route branding, storage adapters, provider setup, screenshots, and product UX remain downstream)
- `ds-astro.mdx-render-adapter` / `@refarm.dev/ds-astro`: a consumer can replace local dgk/vault/astro block packages with @refarm.dev/ds-astro imports while keeping product-specific MDX copy and route semantics downstream (PARA labels, notebook/editorial vocabulary, custom routes, and product-specific blocks remain downstream)

Consumer install hints:

- Vendor dir: `vendor`
- Proof checklist: `consumerProofs`
- Use `consumerInstall.fileSpecs` for direct dependencies and `consumerInstall.pnpmOverrides` for unpublished transitive `@refarm.dev/*` packages.
- If a copied tarball keeps the same package name/version but its `packages[].sha256` changes, follow `consumerInstall.revendorPolicy` before running consumer proofs.

Distribution evidence:

- State: `local-handoff-ready`
- Stable ref: `refarm-handoff://vault-seed-ready`
- Current ref: `refarm-handoff://vault-seed-ready/2026-08-29`
- Rollback: retain previous handoff directory or pinned consumer vendor tarballs

Release boundary audit:

- Command: `release-boundary-audit`
- Status: `ok`
- Selection: `consumer-ready`
- Audited packages: 24
