# consumer-ready handoff

Directory: `.refarm/handoff/vault-seed/2026-08-28`
Status: ok
Acceptance: accepted (23 package(s), 72 required check(s))

| Package | Tarball | SHA256 | Consumer proof |
| --- | --- | --- | --- |
| `@refarm.dev/storage-contract-v1` | `refarm.dev-storage-contract-v1-0.1.0.tgz` | `a6b5a77db4da11e812d3a913499812aaf2751cda51c1a1b802166db28f2d0dcd` | a consumer vendors storage-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present -> wallet |
| `@refarm.dev/identity-contract-v1` | `refarm.dev-identity-contract-v1-0.1.0.tgz` | `951f67145ea5a420abd3aacdca5b3e7b2b5982dc0832e9bf2655877d28816d87` | a consumer vendors identity-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present |
| `@refarm.dev/artifact-contract-v1` | `refarm.dev-artifact-contract-v1-0.1.0.tgz` | `19d248c4a96ecababa22ddbb8b958a04d82be55bfcc9d35a5638ec3b7a6eb7f9` | a consumer emits refarm.task-artifacts.v1 manifests from Lab/outbox/notebook producers |
| `@refarm.dev/channel-policy-v1` | `refarm.dev-channel-policy-v1-0.1.0.tgz` | `59047f5e3678eece2a63a3a8095bdfd0468b2e4e5a82a670a5e20d12dfd8680d` | a consumer's Telegram adapter emits refarm.channel-delivery-envelope.v1 |
| `@refarm.dev/effort-contract-v1` | `refarm.dev-effort-contract-v1-0.1.0.tgz` | `9ef7f9cd94beae4715578bfe35c4524e29bb9c9644aab145dc7765a6ee41ef60` | a consumer's process flows attach effort identifiers to emitted evidence |
| `@refarm.dev/quality-contract-v1` | `refarm.dev-quality-contract-v1-0.1.0.tgz` | `c6738cb03d8c59facc54b2fd8d66649356f2ab5d7fa4bc12391f3debe6de2d48` | a consumer and agent-demo POCs can declare quality intentions through quality:v1 while keeping domain profiles downstream-owned |
| `@refarm.dev/source-contract-v1` | `refarm.dev-source-contract-v1-0.1.0.tgz` | `2351cd7443605bfbfc504b776d6a1dd9e22a82725491d006b93ec7c4d9a73338` | a consumer vendors source-contract-v1 as the source-web transitive override while proving source-web -> records:v1 -> enrichment:v1 composition |
| `@refarm.dev/enrichment-contract-v1` | `refarm.dev-enrichment-contract-v1-0.1.0.tgz` | `896d2f21e6b95a4561adf8480e90eab422f3e2b403fe7743f7b5e9e07d9b1e39` | a consumer emits enrichment:v1 reports from checkout-owned providers while the package supplies only the neutral contract and fixture provider |
| `@refarm.dev/records-contract-v1` | `refarm.dev-records-contract-v1-0.1.0.tgz` | `e42f56681228c36f9d28720e8da53b8ec3e6cdc3b9e40822cb2be749d98a9405` | a consumer validates requirement-like records and notes-to-records projections through records:v1 with a clean reference-vault composition proof |
| `@refarm.dev/process-handoff` | `refarm.dev-process-handoff-0.1.0.tgz` | `6a08b77ca2113cc278fa15762383e62eda396b6413934fb392e546bcf38f06f7` | a consumer's runner keeps run(cmd, args, opts) while using process-handoff internally |
| `@refarm.dev/health` | `refarm.dev-health-0.1.0.tgz` | `86c031492346d517d82d12aecfa3dbd1bfb47a66e7a73ad6265873931f5721c6` | a consumer can replace dgk check-substrate internals with ToolchainAuditor while keeping dgk doctor UX and recovery copy downstream |
| `@refarm.dev/release-engine` | `refarm.dev-release-engine-0.1.0.tgz` | `ba7394c329da27631bca97893b1815fd0308f4abd2643466138fe8acc507965b` | a consumer's release/package smoke consumes release-engine acceptance output |
| `@refarm.dev/heartwood` | `refarm.dev-heartwood-0.1.0.tgz` | `99f07aae42a770faff1f503b22db07a5dcf518637d0aa08b68e84ab738e55f07` | a consumer's credential flow uses silo without local crypto stand-ins |
| `@refarm.dev/silo` | `refarm.dev-silo-0.1.0.tgz` | `dc18d701219ba1a59de6e77588b60ddb94cda154f539996bb9c23f497b04c98e` | a consumer stores model/runtime/publishing credentials through silo namespaces |
| `@refarm.dev/storage-memory` | `refarm.dev-storage-memory-0.1.0.tgz` | `0da13f60be1852bc20cc79559d3e00c4f552ea10e3fd9893f2609bb7b39424be` | sovereign-citizen:reference:test stores and lists the issued credential through storage-memory |
| `@refarm.dev/credentials-contract-v1` | `refarm.dev-credentials-contract-v1-0.1.0.tgz` | `74a46aac7c0c142bde66afe8812a2ff1ac753a4ed6608a5e4d04760757f3f7ef` | a consumer vendors credentials-contract-v1 early and proves issuer/verifier/wallet seams with trustedIssuers, trustSelf, holder-binding, and local signed status-list revocation checks before headspace UX |
| `@refarm.dev/dispatch-surface` | `refarm.dev-dispatch-surface-0.1.0.tgz` | `49b944776f9aecd3b18ba93563c74faa2447d43131df5971fa2da102c9dfce25` | Consumers route channel/transport dispatch operations through these shared primitives. This is NOT a product-command/CLI registry — product commands stay in the consumer command layer (the old wording wrongly suggested modeling CLI commands on it). |
| `@refarm.dev/ds` | `refarm.dev-ds-0.1.0.tgz` | `317978d2d2633190b241b2a5bc6e2bec50fbe123b4ad12929983f4062d7ecbc1` | a consumer's Lab/admin UI imports ds tokens and renders documentHtml through @refarm.dev/ds/html without pulling Homestead |
| `@refarm.dev/source-web` | `refarm.dev-source-web-0.1.0.tgz` | `076420bc8d7ae038e71b86fd9b4cdbbfc24ed73be277f23b4ed021ebf2b37ef1` | a consumer wraps source-web with real checkout-owned source behavior and proves redacted source:v1 snapshots compose into records:v1 and enrichment:v1 |
| `@refarm.dev/content-projection` | `refarm.dev-content-projection-0.1.0.tgz` | `2eb06edf0d4062f67299b608dda0d17600ab0d5cee5e5c93202a233a1d19e8cc` | a consumer can replace local note-to-record, wikilink, and inline-link projection helpers with the generic projection block while retaining its product configuration |
| `@refarm.dev/identity-heartwood` | `refarm.dev-identity-heartwood-0.1.0.tgz` | `2caf90063ea8b94749cf9ea7167defa9e51d7cec033b26cc82f0becade982295` | sovereign-citizen:reference:test proves real Ed25519 issue and present signatures through identity:v1 |
| `@refarm.dev/local-surface` | `refarm.dev-local-surface-0.1.0.tgz` | `1116238c5d39325386aa28a9c7dd16487655fad6906b7dc130afb37993be4234` | a consumer can build a local-surface:v1 manifest, DS-backed HTML, white-label launch plan, and quality:v1 report while keeping routes, screenshots, provider adapters, and product vocabulary downstream-owned |
| `@refarm.dev/ds-astro` | `refarm.dev-ds-astro-0.1.0.tgz` | `e17da7624dfa0ddf2fd818acd776c6604bf8c5bc9da1d679dcf8eb514db5992d` | a consumer can replace local dgk/vault/astro block packages with @refarm.dev/ds-astro imports while keeping product-specific MDX copy and route semantics downstream |

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
- Current ref: `refarm-handoff://vault-seed-ready/2026-08-28`
- Rollback: retain previous handoff directory or pinned consumer vendor tarballs

Release boundary audit:

- Command: `release-boundary-audit`
- Status: `ok`
- Selection: `consumer-ready`
- Audited packages: 23
