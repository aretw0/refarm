# consumer-ready handoff

Directory: `.refarm/handoff/vault-seed/2026-08-30`
Status: ok
Acceptance: accepted (27 package(s), 88 required check(s))

| Package | Tarball | SHA256 | Consumer proof |
| --- | --- | --- | --- |
| `@refarm.dev/storage-contract-v1` | `refarm.dev-storage-contract-v1-0.1.0.tgz` | `a79681463b1735f207d2f2b42dd41a387d570dad41c53fa5199f31abd20a5576` | a consumer vendors storage-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present -> wallet |
| `@refarm.dev/identity-contract-v1` | `refarm.dev-identity-contract-v1-0.1.0.tgz` | `951f67145ea5a420abd3aacdca5b3e7b2b5982dc0832e9bf2655877d28816d87` | a consumer vendors identity-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present |
| `@refarm.dev/artifact-contract-v1` | `refarm.dev-artifact-contract-v1-0.1.0.tgz` | `19d248c4a96ecababa22ddbb8b958a04d82be55bfcc9d35a5638ec3b7a6eb7f9` | a consumer emits sovereign.task-artifacts.v1 manifests from Lab/outbox/notebook producers |
| `@refarm.dev/channel-policy-v1` | `refarm.dev-channel-policy-v1-0.1.0.tgz` | `984b55e8a57e4c534c73655791caf252f2e2ab9b0c107144c8bf928cb5b6e004` | a consumer's Telegram adapter emits refarm.channel-delivery-envelope.v1 |
| `@refarm.dev/effort-contract-v1` | `refarm.dev-effort-contract-v1-0.1.0.tgz` | `9ef7f9cd94beae4715578bfe35c4524e29bb9c9644aab145dc7765a6ee41ef60` | a consumer's process flows attach effort identifiers to emitted evidence |
| `@refarm.dev/quality-contract-v1` | `refarm.dev-quality-contract-v1-0.1.0.tgz` | `36049781cfb763b524a2f4b6cb7156d4031bcd7b9224cbc80c21c600afc73868` | a consumer and agent-demo POCs can declare quality intentions through quality:v1 while keeping domain profiles downstream-owned |
| `@refarm.dev/provenance-contract-v1` | `refarm.dev-provenance-contract-v1-0.1.0.tgz` | `2a21e432bb34b8810913bf0315a6f7989bfb40740e8020d25c757e9397e507cf` | a consumer stamps and verifies provenance:v1 on its own input records — notes, requirements, or a materials database — and can gate on the named checks while keeping its source vocabulary and evidence policy downstream-owned |
| `@refarm.dev/std` | `refarm.dev-std-0.1.0.tgz` | `3bc4dadfcc6a93d90653b241edd72239b8bfec8ace16e1e34179ba29311677c7` | a consumer that installs vault-contract-v1 from the registry resolves @refarm.dev/std as a published dependency instead of a vendored override, and never has to re-implement its primitives |
| `@refarm.dev/node-contract-v1` | `refarm.dev-node-contract-v1-0.1.0.tgz` | `b45b085b8371e8e62282bb3d33db08d723f06b9f97329aa3eac30ce7416ea87d` | a consumer's records and vault contracts resolve node:v1 from the registry; the base shape and its conversions are the only thing this package owns |
| `@refarm.dev/source-contract-v1` | `refarm.dev-source-contract-v1-0.1.0.tgz` | `10c33c815def0120e83fae2dc9348db4f09e5acb7756ac16469da8d9063c78a8` | a consumer vendors source-contract-v1 as the source-web transitive override while proving source-web -> records:v1 -> enrichment:v1 composition |
| `@refarm.dev/enrichment-contract-v1` | `refarm.dev-enrichment-contract-v1-0.1.0.tgz` | `896d2f21e6b95a4561adf8480e90eab422f3e2b403fe7743f7b5e9e07d9b1e39` | a consumer emits enrichment:v1 reports from checkout-owned providers while the package supplies only the neutral contract and fixture provider |
| `@refarm.dev/records-contract-v1` | `refarm.dev-records-contract-v1-0.1.0.tgz` | `3355f5026397d4fb55f60ba964ae347a442730d8ae279a501f09d8058a419686` | a consumer validates requirement-like records and notes-to-records projections through records:v1 with a clean reference-vault composition proof |
| `@refarm.dev/process-handoff` | `refarm.dev-process-handoff-0.1.0.tgz` | `3768f81f6809d58a6e2a99f9023e07b26e9c6d8ec254840c0106d69903a633f0` | a consumer's runner keeps run(cmd, args, opts) while using process-handoff internally |
| `@refarm.dev/release-engine` | `refarm.dev-release-engine-0.1.0.tgz` | `ba7394c329da27631bca97893b1815fd0308f4abd2643466138fe8acc507965b` | a consumer's release/package smoke consumes release-engine acceptance output |
| `@refarm.dev/heartwood` | `refarm.dev-heartwood-0.1.0.tgz` | `99f07aae42a770faff1f503b22db07a5dcf518637d0aa08b68e84ab738e55f07` | a consumer's credential flow uses silo without local crypto stand-ins |
| `@refarm.dev/silo` | `refarm.dev-silo-0.1.0.tgz` | `31313b61e643466fc23daf9983f9d288a504cc7c62ec002cea46211f2ed8a3d3` | a consumer stores model/runtime/publishing credentials through silo namespaces |
| `@refarm.dev/plugin-manifest` | `refarm.dev-plugin-manifest-0.1.0.tgz` | `6dea758c4a449c597d047998cce4a5a36ce1ff30e6e336af4ce36ce4065bc493` | a consumer's vault contract resolves the manifest:v1 types and validators from the registry; plugin installation, trust decisions and runtime hosting stay with the host |
| `@refarm.dev/storage-memory` | `refarm.dev-storage-memory-0.1.0.tgz` | `051808f53b6f346cf85c2710c8b44fa2856a66b515ffd02f4633c76dffc8177c` | sovereign-citizen:reference:test stores and lists the issued credential through storage-memory |
| `@refarm.dev/credentials-contract-v1` | `refarm.dev-credentials-contract-v1-0.1.0.tgz` | `74a46aac7c0c142bde66afe8812a2ff1ac753a4ed6608a5e4d04760757f3f7ef` | a consumer vendors credentials-contract-v1 early and proves issuer/verifier/wallet seams with trustedIssuers, trustSelf, holder-binding, and local signed status-list revocation checks before headspace UX |
| `@refarm.dev/dispatch-surface` | `refarm.dev-dispatch-surface-0.1.0.tgz` | `c68225e06b9298b838dc2d0f00474e33bfece9202dae3420d7bb169e2a6460d0` | Consumers route channel/transport dispatch operations through these shared primitives. This is NOT a product-command/CLI registry — product commands stay in the consumer command layer (the old wording wrongly suggested modeling CLI commands on it). |
| `@refarm.dev/ds` | `refarm.dev-ds-0.1.0.tgz` | `ec5e4978adf5b63c4c866200c23bb2cae69ae3ba6cfa2006456f297093f7e847` | a consumer's Lab/admin UI imports ds tokens and renders documentHtml through @refarm.dev/ds/html without pulling Homestead |
| `@refarm.dev/source-web` | `refarm.dev-source-web-0.1.0.tgz` | `a0484881937d26ff836a8cbfa0f2ae32927c9954fb5bf622a635b6b9be4b17a2` | a consumer wraps source-web with real checkout-owned source behavior and proves redacted source:v1 snapshots compose into records:v1 and enrichment:v1 |
| `@refarm.dev/content-projection` | `refarm.dev-content-projection-0.1.0.tgz` | `8e6be6d6ec021cbcb7878a8f9e129b1e379be7a8464d596dbdff814773b38562` | a consumer can replace local note-to-record, wikilink, and inline-link projection helpers with the generic projection block while retaining its product configuration |
| `@refarm.dev/identity-heartwood` | `refarm.dev-identity-heartwood-0.1.0.tgz` | `2caf90063ea8b94749cf9ea7167defa9e51d7cec033b26cc82f0becade982295` | sovereign-citizen:reference:test proves real Ed25519 issue and present signatures through identity:v1 |
| `@refarm.dev/vault-contract-v1` | `refarm.dev-vault-contract-v1-0.1.0.tgz` | `8e328f8f9dfe36944996d60fc4cd40ae854efc0f938d05b6fa1ae3ee06778d24` | a consumer can run vault:v1 corpus health over its own records:v1 projection and surface the findings, while keeping its privacy heuristics, folder policy, and PII vocabulary downstream-owned |
| `@refarm.dev/local-surface` | `refarm.dev-local-surface-0.1.0.tgz` | `2cd824f97064a35276e17dd2593fc508a8c3f198c1eff456624752c8efd6b28d` | a consumer can build a local-surface:v1 manifest, DS-backed HTML, white-label launch plan, and quality:v1 report while keeping routes, screenshots, provider adapters, and product vocabulary downstream-owned |
| `@refarm.dev/ds-astro` | `refarm.dev-ds-astro-0.1.0.tgz` | `e17da7624dfa0ddf2fd818acd776c6604bf8c5bc9da1d679dcf8eb514db5992d` | a consumer can replace local dgk/vault/astro block packages with @refarm.dev/ds-astro imports while keeping product-specific MDX copy and route semantics downstream |

Consumer proofs:

- `credentials-storage-contract.transitive-wallet-support` / `@refarm.dev/storage-contract-v1`: a consumer vendors storage-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present -> wallet (Durable wallet persistence, retention, encryption policy, and wallet UX remain downstream)
- `credentials-identity-contract.transitive-signature-support` / `@refarm.dev/identity-contract-v1`: a consumer vendors identity-contract-v1 as credentials-contract-v1 support while proving issue -> verify -> present (Issuer trust, DID methods, account recovery, and identity UX remain downstream)
- `artifact-contract.lab-outbox-evidence` / `@refarm.dev/artifact-contract-v1`: a consumer emits sovereign.task-artifacts.v1 manifests from Lab/outbox/notebook producers (Vault schemas, notebook UX, and frontmatter remain downstream)
- `channel-policy.telegram-delivery-envelope` / `@refarm.dev/channel-policy-v1`: a consumer's Telegram adapter emits refarm.channel-delivery-envelope.v1 (Provider API calls, copy formatting, and inbox/outbox UX remain downstream)
- `effort-contract.dgk-effort-evidence` / `@refarm.dev/effort-contract-v1`: a consumer's process flows attach effort identifiers to emitted evidence (dgk command vocabulary and operator UX remain downstream)
- `quality-contract.declared-lint-envelope` / `@refarm.dev/quality-contract-v1`: a consumer and agent-demo POCs can declare quality intentions through quality:v1 while keeping domain profiles downstream-owned (Rule catalogs, severity policy, product copy, personas, and rendered-subject collection remain downstream)
- `provenance-contract.origin-of-every-input` / `@refarm.dev/provenance-contract-v1`: a consumer stamps and verifies provenance:v1 on its own input records — notes, requirements, or a materials database — and can gate on the named checks while keeping its source vocabulary and evidence policy downstream-owned (Source catalogs, licensing policy, which checks block, and the domain fields that ride beside provenance remain downstream)
- `std.pure-primitives-behind-a-published-contract` / `@refarm.dev/std`: a consumer that installs vault-contract-v1 from the registry resolves @refarm.dev/std as a published dependency instead of a vendored override, and never has to re-implement its primitives (Listeners, servers, files, processes and product naming stay with the host; this package owns pure decisions and vocabulary only)
- `node-contract.base-graph-node-shape` / `@refarm.dev/node-contract-v1`: a consumer's records and vault contracts resolve node:v1 from the registry; the base shape and its conversions are the only thing this package owns (Storage, sync, signing and the domain vocabulary above @type stay downstream)
- `requirements-source-contract.transitive-source-web-support` / `@refarm.dev/source-contract-v1`: a consumer vendors source-contract-v1 as the source-web transitive override while proving source-web -> records:v1 -> enrichment:v1 composition (Concrete login, selectors, and source profile vocabulary remain downstream)
- `requirements-enrichment.private-provider-wrapper` / `@refarm.dev/enrichment-contract-v1`: a consumer emits enrichment:v1 reports from checkout-owned providers while the package supplies only the neutral contract and fixture provider (Private registries, lookup adapters, tag vocabulary, and domain enrichment rules remain downstream)
- `requirements-records.knowledge-manifest` / `@refarm.dev/records-contract-v1`: a consumer validates requirement-like records and notes-to-records projections through records:v1 with a clean reference-vault composition proof (PARA placement, editorial model, note rendering, and domain labels remain downstream)
- `process-handoff.dgk-runner-adapter` / `@refarm.dev/process-handoff`: a consumer's runner keeps run(cmd, args, opts) while using process-handoff internally (dgk package names, binary, commands, and product labels remain downstream)
- `release-engine.package-acceptance` / `@refarm.dev/release-engine`: a consumer's release/package smoke consumes release-engine acceptance output (Distribution identity, prose, and changelog content remain downstream)
- `heartwood.silo-crypto-substrate` / `@refarm.dev/heartwood`: a consumer's credential flow uses silo without local crypto stand-ins (Credential policy choices and publishing identities remain downstream)
- `silo.credential-namespaces` / `@refarm.dev/silo`: a consumer stores model/runtime/publishing credentials through silo namespaces (Provider-specific publishing adapters and approval workflow remain downstream)
- `plugin-manifest.manifest-v1-as-a-dependency` / `@refarm.dev/plugin-manifest`: a consumer's vault contract resolves the manifest:v1 types and validators from the registry; plugin installation, trust decisions and runtime hosting stay with the host (Install policy, trust, WASM/runtime hosting and registries remain host-owned; the package owns the manifest shape, its validation and its fixtures)
- `credentials-storage-memory.reference-wallet` / `@refarm.dev/storage-memory`: sovereign-citizen:reference:test stores and lists the issued credential through storage-memory (Production durability, synchronization, encryption-at-rest, and wallet UX remain downstream)
- `credentials-contract.issue-verify-present-wallet` / `@refarm.dev/credentials-contract-v1`: a consumer vendors credentials-contract-v1 early and proves issuer/verifier/wallet seams with trustedIssuers, trustSelf, holder-binding, and local signed status-list revocation checks before headspace UX (Issuer authorities, credential schemas, trust registry sources, remote status-list distribution, trust UI, and domain vocabulary remain downstream)
- `dispatch-surface.dgk-descriptor` / `@refarm.dev/dispatch-surface`: Consumers route channel/transport dispatch operations through these shared primitives. This is NOT a product-command/CLI registry — product commands stay in the consumer command layer (the old wording wrongly suggested modeling CLI commands on it). (Surface labels, routes, and product-specific actions remain downstream)
- `ds.lab-admin-static-document` / `@refarm.dev/ds`: a consumer's Lab/admin UI imports ds tokens and renders documentHtml through @refarm.dev/ds/html without pulling Homestead (PARA vocabulary, editorial copy, and content semantics remain downstream)
- `requirements-source-web.authenticated-capture` / `@refarm.dev/source-web`: a consumer wraps source-web with real checkout-owned source behavior and proves redacted source:v1 snapshots compose into records:v1 and enrichment:v1 (Real credentials, discovery, selectors, pacing values, and source-specific ETL profiles remain downstream)
- `content-projection.markdown-mdx-records` / `@refarm.dev/content-projection`: a consumer can replace local note-to-record, wikilink, and inline-link projection helpers with the generic projection block while retaining its product configuration (PARA folder mapping, note vocabulary, Obsidian/Foam conventions, and rendering remain downstream)
- `credentials-identity-heartwood.reference-signature` / `@refarm.dev/identity-heartwood`: sovereign-citizen:reference:test proves real Ed25519 issue and present signatures through identity:v1 (Trust registry, default identity provider choice, secret persistence, and DID resolution remain downstream)
- `vault-contract.corpus-health-over-projected-records` / `@refarm.dev/vault-contract-v1`: a consumer can run vault:v1 corpus health over its own records:v1 projection and surface the findings, while keeping its privacy heuristics, folder policy, and PII vocabulary downstream-owned (Privacy heuristics, PII candidate detection, designated-folder policy, note vocabulary, and surface rendering remain downstream)
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
- Current ref: `refarm-handoff://vault-seed-ready/2026-08-30`
- Rollback: retain previous handoff directory or pinned consumer vendor tarballs

Release boundary audit:

- Command: `release-boundary-audit`
- Status: `ok`
- Selection: `consumer-ready`
- Audited packages: 27

Pruned generated extras:

- `refarm.dev-health-0.1.0.tgz`
