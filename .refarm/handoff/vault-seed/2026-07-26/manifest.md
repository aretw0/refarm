# consumer-ready handoff

Directory: `.refarm/handoff/vault-seed/2026-07-26`
Status: ok
Acceptance: accepted (23 package(s), 72 required check(s))

| Package | Tarball | SHA256 | Consumer proof |
| --- | --- | --- | --- |
| `@refarm.dev/storage-contract-v1` | `refarm.dev-storage-contract-v1-0.1.0.tgz` | `ca4a9f10f77eda2f8be143c9625a0b70a814d12dfe8d715a6ddd3c7f0c68743d` | vault-seed vendors storage-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present -> wallet |
| `@refarm.dev/identity-contract-v1` | `refarm.dev-identity-contract-v1-0.1.0.tgz` | `b36b23c458a07f56b02f9cfd648259505d9354c3357946ee44cf4a00594e9dac` | vault-seed vendors identity-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present |
| `@refarm.dev/artifact-contract-v1` | `refarm.dev-artifact-contract-v1-0.1.0.tgz` | `19d248c4a96ecababa22ddbb8b958a04d82be55bfcc9d35a5638ec3b7a6eb7f9` | vault-seed emits refarm.task-artifacts.v1 manifests from Lab/outbox/notebook producers |
| `@refarm.dev/channel-policy-v1` | `refarm.dev-channel-policy-v1-0.1.0.tgz` | `984b55e8a57e4c534c73655791caf252f2e2ab9b0c107144c8bf928cb5b6e004` | vault-seed Telegram adapter emits refarm.channel-delivery-envelope.v1 |
| `@refarm.dev/effort-contract-v1` | `refarm.dev-effort-contract-v1-0.1.0.tgz` | `724aac79d9530aa610545ffdaffd3266d87b1239225a9c7a5d075e39d70e7fd7` | dgk process flows attach effort identifiers to emitted evidence |
| `@refarm.dev/quality-contract-v1` | `refarm.dev-quality-contract-v1-0.1.0.tgz` | `2a77254588670060a6025b87906f3e159335fdec745817ab0767686ecdaac97b` | vault-seed and agent-demo POCs can declare quality intentions through quality:v1 while keeping domain profiles downstream-owned |
| `@refarm.dev/source-contract-v1` | `refarm.dev-source-contract-v1-0.1.0.tgz` | `8001ec758892a996c5d04c64401d32859a7dd1fc46e175bc718fcdfb9736b280` | vault-seed vendors source-contract-v1 as the source-web transitive override while proving source-web -> records:v1 -> enrichment:v1 composition |
| `@refarm.dev/enrichment-contract-v1` | `refarm.dev-enrichment-contract-v1-0.1.0.tgz` | `c8b1eff867108cec6a1d891b89ce76dbb544b3042c2d232bd3d65b9bb2c9dc77` | vault-seed emits enrichment:v1 reports from checkout-owned providers while the package supplies only the neutral contract and fixture provider |
| `@refarm.dev/records-contract-v1` | `refarm.dev-records-contract-v1-0.1.0.tgz` | `3e665f81a9fdd74899174907ea8af965aca2fa631c3665294538add61be00434` | vault-seed validates requirement-like records and notes-to-records projections through records:v1 with a clean reference-vault composition proof |
| `@refarm.dev/process-handoff` | `refarm.dev-process-handoff-0.1.0.tgz` | `03cb926af9eca02150b71701e370f09b9216477f11333fae8971e7e2b42daff9` | dgk-runner keeps run(cmd, args, opts) while using process-handoff internally |
| `@refarm.dev/health` | `refarm.dev-health-0.1.0.tgz` | `d2840e9018a431f72a757eaf482234d33889c5a5fb9937ba2c4f7be68f743132` | vault-seed can replace dgk check-substrate internals with ToolchainAuditor while keeping dgk doctor UX and recovery copy downstream |
| `@refarm.dev/release-engine` | `refarm.dev-release-engine-0.1.0.tgz` | `2c485ec253954e250eaae98e4e4359ca89a1fa3034bcad3f0e8f0ba41c8dcca7` | vault-seed release/package smoke consumes release-engine acceptance output |
| `@refarm.dev/heartwood` | `refarm.dev-heartwood-0.1.0.tgz` | `99f07aae42a770faff1f503b22db07a5dcf518637d0aa08b68e84ab738e55f07` | vault-seed credential flow uses silo without local crypto stand-ins |
| `@refarm.dev/silo` | `refarm.dev-silo-0.1.0.tgz` | `69050483d2580b21878eb1920b8dacea551857f427137c006e56348a8157d6fb` | vault-seed stores model/runtime/publishing credentials through silo namespaces |
| `@refarm.dev/storage-memory` | `refarm.dev-storage-memory-0.1.0.tgz` | `0da13f60be1852bc20cc79559d3e00c4f552ea10e3fd9893f2609bb7b39424be` | sovereign-citizen:reference:test stores and lists the issued credential through storage-memory |
| `@refarm.dev/credentials-contract-v1` | `refarm.dev-credentials-contract-v1-0.1.0.tgz` | `5797caa35a9ee4a137448e688d3f0a41e6f283008101b6307d999ceb5536f86f` | vault-seed vendors credentials-contract-v1 early and proves issuer/verifier/wallet seams with trustedIssuers, trustSelf, holder-binding, and local signed status-list revocation checks before headspace UX |
| `@refarm.dev/dispatch-surface` | `refarm.dev-dispatch-surface-0.1.0.tgz` | `c68225e06b9298b838dc2d0f00474e33bfece9202dae3420d7bb169e2a6460d0` | Consumers route channel/transport dispatch operations through these shared primitives. This is NOT a product-command/CLI registry — product commands stay in the consumer command layer (the old wording wrongly suggested modeling CLI commands on it). |
| `@refarm.dev/ds` | `refarm.dev-ds-0.1.0.tgz` | `b7b8bd4b4522f33a65d859ca6e4542318767c549a0017cdeec114fdbb87f57e5` | vault-seed Lab/admin UI imports ds tokens and renders documentHtml through @refarm.dev/ds/html without pulling Homestead |
| `@refarm.dev/source-web` | `refarm.dev-source-web-0.1.0.tgz` | `076420bc8d7ae038e71b86fd9b4cdbbfc24ed73be277f23b4ed021ebf2b37ef1` | vault-seed wraps source-web with real checkout-owned source behavior and proves redacted source:v1 snapshots compose into records:v1 and enrichment:v1 |
| `@refarm.dev/content-projection` | `refarm.dev-content-projection-0.1.0.tgz` | `9ba431d916ca8bda6bec9566d35caa9f8f3ea97399b39fcc5c0f401550527981` | vault-seed can replace local note-to-record, wikilink, and inline-link projection helpers with the generic projection block while retaining its product configuration |
| `@refarm.dev/identity-heartwood` | `refarm.dev-identity-heartwood-0.1.0.tgz` | `2f70b2e39375cde797143ab7d2164719dac13d032198951c679bebda0ad714fd` | sovereign-citizen:reference:test proves real Ed25519 issue and present signatures through identity:v1 |
| `@refarm.dev/local-surface` | `refarm.dev-local-surface-0.1.0.tgz` | `1ac038601d1da4d73aa01eb88770e3137fe143290a3726823899f5e72e1d03e5` | vault-seed can build a local-surface:v1 manifest, DS-backed HTML, white-label launch plan, and quality:v1 report while keeping routes, screenshots, provider adapters, and product vocabulary downstream-owned |
| `@refarm.dev/ds-astro` | `refarm.dev-ds-astro-0.1.0.tgz` | `e17da7624dfa0ddf2fd818acd776c6604bf8c5bc9da1d679dcf8eb514db5992d` | vault-seed can replace local dgk/vault/astro block packages with @refarm.dev/ds-astro imports while keeping product-specific MDX copy and route semantics downstream |

Consumer proofs:

- `credentials-storage-contract.transitive-wallet-support` / `@refarm.dev/storage-contract-v1`: vault-seed vendors storage-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present -> wallet (Durable wallet persistence, retention, encryption policy, and wallet UX remain downstream)
- `credentials-identity-contract.transitive-signature-support` / `@refarm.dev/identity-contract-v1`: vault-seed vendors identity-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present (Issuer trust, DID methods, account recovery, and identity UX remain downstream)
- `artifact-contract.lab-outbox-evidence` / `@refarm.dev/artifact-contract-v1`: vault-seed emits refarm.task-artifacts.v1 manifests from Lab/outbox/notebook producers (Vault schemas, notebook UX, and frontmatter remain downstream)
- `channel-policy.telegram-delivery-envelope` / `@refarm.dev/channel-policy-v1`: vault-seed Telegram adapter emits refarm.channel-delivery-envelope.v1 (Provider API calls, copy formatting, and inbox/outbox UX remain downstream)
- `effort-contract.dgk-effort-evidence` / `@refarm.dev/effort-contract-v1`: dgk process flows attach effort identifiers to emitted evidence (dgk command vocabulary and operator UX remain downstream)
- `quality-contract.declared-lint-envelope` / `@refarm.dev/quality-contract-v1`: vault-seed and agent-demo POCs can declare quality intentions through quality:v1 while keeping domain profiles downstream-owned (Rule catalogs, severity policy, product copy, personas, and rendered-subject collection remain downstream)
- `requirements-source-contract.transitive-source-web-support` / `@refarm.dev/source-contract-v1`: vault-seed vendors source-contract-v1 as the source-web transitive override while proving source-web -> records:v1 -> enrichment:v1 composition (Concrete login, selectors, and source profile vocabulary remain downstream)
- `requirements-enrichment.private-provider-wrapper` / `@refarm.dev/enrichment-contract-v1`: vault-seed emits enrichment:v1 reports from checkout-owned providers while the package supplies only the neutral contract and fixture provider (Private registries, lookup adapters, tag vocabulary, and domain enrichment rules remain downstream)
- `requirements-records.knowledge-manifest` / `@refarm.dev/records-contract-v1`: vault-seed validates requirement-like records and notes-to-records projections through records:v1 with a clean reference-vault composition proof (PARA placement, editorial model, note rendering, and domain labels remain downstream)
- `process-handoff.dgk-runner-adapter` / `@refarm.dev/process-handoff`: dgk-runner keeps run(cmd, args, opts) while using process-handoff internally (dgk package names, binary, commands, and product labels remain downstream)
- `health.toolchain-environment-auditor` / `@refarm.dev/health`: vault-seed can replace dgk check-substrate internals with ToolchainAuditor while keeping dgk doctor UX and recovery copy downstream (Project-specific command names, setup recommendations, required file policy, and health+quality composition remain downstream)
- `release-engine.package-acceptance` / `@refarm.dev/release-engine`: vault-seed release/package smoke consumes release-engine acceptance output (Distribution identity, prose, and changelog content remain downstream)
- `heartwood.silo-crypto-substrate` / `@refarm.dev/heartwood`: vault-seed credential flow uses silo without local crypto stand-ins (Credential policy choices and publishing identities remain downstream)
- `silo.credential-namespaces` / `@refarm.dev/silo`: vault-seed stores model/runtime/publishing credentials through silo namespaces (Provider-specific publishing adapters and approval workflow remain downstream)
- `credentials-storage-memory.reference-wallet` / `@refarm.dev/storage-memory`: sovereign-citizen:reference:test stores and lists the issued credential through storage-memory (Production durability, synchronization, encryption-at-rest, and wallet UX remain downstream)
- `credentials-contract.issue-verify-present-wallet` / `@refarm.dev/credentials-contract-v1`: vault-seed vendors credentials-contract-v1 early and proves issuer/verifier/wallet seams with trustedIssuers, trustSelf, holder-binding, and local signed status-list revocation checks before headspace UX (Issuer authorities, credential schemas, trust registry sources, remote status-list distribution, trust UI, and domain vocabulary remain downstream)
- `dispatch-surface.dgk-descriptor` / `@refarm.dev/dispatch-surface`: Consumers route channel/transport dispatch operations through these shared primitives. This is NOT a product-command/CLI registry — product commands stay in the consumer command layer (the old wording wrongly suggested modeling CLI commands on it). (Surface labels, routes, and product-specific actions remain downstream)
- `ds.lab-admin-static-document` / `@refarm.dev/ds`: vault-seed Lab/admin UI imports ds tokens and renders documentHtml through @refarm.dev/ds/html without pulling Homestead (PARA vocabulary, editorial copy, and content semantics remain downstream)
- `requirements-source-web.authenticated-capture` / `@refarm.dev/source-web`: vault-seed wraps source-web with real checkout-owned source behavior and proves redacted source:v1 snapshots compose into records:v1 and enrichment:v1 (Real credentials, discovery, selectors, pacing values, and source-specific ETL profiles remain downstream)
- `content-projection.markdown-mdx-records` / `@refarm.dev/content-projection`: vault-seed can replace local note-to-record, wikilink, and inline-link projection helpers with the generic projection block while retaining its product configuration (PARA folder mapping, note vocabulary, Obsidian/Foam conventions, and rendering remain downstream)
- `credentials-identity-heartwood.reference-signature` / `@refarm.dev/identity-heartwood`: sovereign-citizen:reference:test proves real Ed25519 issue and present signatures through identity:v1 (Trust registry, default identity provider choice, secret persistence, and DID resolution remain downstream)
- `local-surface.white-label-operator-proof` / `@refarm.dev/local-surface`: vault-seed can build a local-surface:v1 manifest, DS-backed HTML, white-label launch plan, and quality:v1 report while keeping routes, screenshots, provider adapters, and product vocabulary downstream-owned (Server binding, route branding, storage adapters, provider setup, screenshots, and product UX remain downstream)
- `ds-astro.mdx-render-adapter` / `@refarm.dev/ds-astro`: vault-seed can replace local dgk/vault/astro block packages with @refarm.dev/ds-astro imports while keeping product-specific MDX copy and route semantics downstream (PARA labels, notebook/editorial vocabulary, custom routes, and product-specific blocks remain downstream)

Consumer install hints:

- Vendor dir: `vendor`
- Proof checklist: `consumerProofs`
- Use `consumerInstall.fileSpecs` for direct dependencies and `consumerInstall.pnpmOverrides` for unpublished transitive `@refarm.dev/*` packages.
- If a copied tarball keeps the same package name/version but its `packages[].sha256` changes, follow `consumerInstall.revendorPolicy` before running consumer proofs.

Distribution evidence:

- State: `local-handoff-ready`
- Stable ref: `refarm-handoff://consumer-ready`
- Current ref: `refarm-handoff://consumer-ready/2026-07-26`
- Rollback: retain previous handoff directory or pinned consumer vendor tarballs

Release boundary audit:

- Command: `release-boundary-audit`
- Status: `ok`
- Selection: `consumer-ready`
- Audited packages: 23
