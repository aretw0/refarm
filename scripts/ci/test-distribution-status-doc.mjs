import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildReleaseCheckPlan } from "../release-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const doc = readFileSync(
	path.join(ROOT, "packages/DISTRIBUTION_STATUS.md"),
	"utf8",
);
const packageRegistryDoc = readFileSync(
	path.join(ROOT, "packages/README.md"),
	"utf8",
);
const vaultSeedConvergenceDoc = readFileSync(
	path.join(ROOT, "docs/VAULT_SEED_CONVERGENCE.md"),
	"utf8",
);
const crossRepoConsumptionDoc = readFileSync(
	path.join(ROOT, "docs/DEV_CROSS_REPO_CONSUMPTION.md"),
	"utf8",
);
const releaseGateDoc = readFileSync(
	path.join(ROOT, "docs/v0.1.0-release-gate.md"),
	"utf8",
);
const releasePolicyDoc = readFileSync(
	path.join(ROOT, "docs/RELEASE_POLICY.md"),
	"utf8",
);
const factoryReadinessDoc = readFileSync(
	path.join(ROOT, "docs/CONVERGENCE_FACTORY_READINESS.md"),
	"utf8",
);
const refarmWorkFocusDoc = readFileSync(
	path.join(ROOT, "docs/REFARM_WORK_FOCUS.md"),
	"utf8",
);
const convergenceRoadmapDoc = readFileSync(
	path.join(ROOT, "docs/CONVERGENCE_ROADMAP.md"),
	"utf8",
);
const qualityAgentBuildOrderDoc = readFileSync(
	path.join(ROOT, "docs/QUALITY_AGENT_BUILD_ORDER.md"),
	"utf8",
);
const decisionLogDoc = readFileSync(
	path.join(ROOT, "docs/decision-log.md"),
	"utf8",
);
const vaultSeedHandoffPlan = readFileSync(
	path.join(ROOT, "docs/superpowers/plans/2026-06-26-vault-seed-ready-handoff.md"),
	"utf8",
);
const dsTokenContractPlan = readFileSync(
	path.join(ROOT, "docs/superpowers/plans/2026-06-25-ds-token-contract.md"),
	"utf8",
);
const channelPolicyBridgePlan = readFileSync(
	path.join(ROOT, "docs/superpowers/plans/2026-06-26-channel-policy-bridge.md"),
	"utf8",
);
const artifactLabEvidencePlan = readFileSync(
	path.join(ROOT, "docs/superpowers/plans/2026-06-26-artifact-lab-evidence.md"),
	"utf8",
);
const vaultSeedHandoffAdr = readFileSync(
	path.join(ROOT, "specs/ADRs/ADR-080-vault-seed-ready-handoff-pipeline.md"),
	"utf8",
);
const releaseConvergencePlan = readFileSync(
	path.join(ROOT, "docs/superpowers/plans/2026-07-03-refarm-vault-seed-release-convergence.md"),
	"utf8",
);
const channelPolicyBridgeSpec = readFileSync(
	path.join(ROOT, "specs/features/2026-06-26-channel-policy-bridge.md"),
	"utf8",
);
const processHandoffBridgeSpec = readFileSync(
	path.join(ROOT, "specs/features/2026-06-26-process-handoff-provenance-bridge.md"),
	"utf8",
);
const dsTokenContractSpec = readFileSync(
	path.join(ROOT, "specs/features/2026-06-25-ds-token-contract.md"),
	"utf8",
);
const vaultSeedSiloBridgeSpec = readFileSync(
	path.join(ROOT, "specs/features/2026-06-26-vault-seed-silo-bridge.md"),
	"utf8",
);
const localSurfaceSpec = readFileSync(
	path.join(ROOT, "specs/features/2026-07-03-local-surface-v1.md"),
	"utf8",
);
const packagesReadme = readFileSync(
	path.join(ROOT, "packages/README.md"),
	"utf8",
);

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function releaseSelectionNames(selectionId = "default") {
	const check = buildReleaseCheckPlan({
		cwd: ROOT,
		env: {
			REFARM_PACKAGE_MANAGER: "pnpm",
		},
		selectionId,
	});
	assert.equal(check.ok, true);
	return check.plan.orderedNames;
}

test("distribution status reflects release-policy selections", () => {
	assert.doesNotMatch(
		doc,
		/READY FOR v0\.1\.0 ALPHA DISTRIBUTION \(3 Contracts\)/,
	);
	assert.match(doc, /daily-driver gate/);
	assert.match(doc, /kernel-candidates/);
	assert.match(doc, /consumer-ready/);
	assert.match(doc, /schemaVersion: 1/);
	assert.match(doc, /consumerPull/);
	assert.match(doc, /Each selected package entry carries `consumerPull` metadata in\s+`refarm\.config\.json`/);
	assert.match(doc, /consumerInstall/);
	assert.match(doc, /consumerProofs/);
	assert.match(doc, /handoff script flattens the policy metadata\s+into `consumerProofs`/);
	assert.match(doc, /distributionEvidence/);
	assert.match(doc, /prunedExtra/);
	assert.match(doc, /proofId/);
	assert.match(doc, /\.refarm\/handoff\/vault-seed\/<YYYY-MM-DD>\//);
	assert.match(doc, /manifest\.json/);
	assert.match(doc, /manifest\.md/);
	assert.match(doc, /--out \.refarm\/handoff\/vault-seed\/<YYYY-MM-DD>\/manifest\.json/);
	assert.match(doc, /official consumer checkout should collect the `\.tgz` files/);
	assert.match(doc, /tarball freshness/);
	assert.match(doc, /publishable build-output\s+freshness/);
	assert.match(vaultSeedHandoffAdr, /Consumer-pull canon is the release policy/);
	assert.match(vaultSeedHandoffAdr, /must not keep a parallel\s+package-name map/);
	assert.doesNotMatch(
		doc,
		/currently lives under\s+`\.refarm\/handoff\/vault-seed\/\d{4}-\d{2}-\d{2}\//,
	);

	for (const packageName of releaseSelectionNames("default")) {
		assert.match(doc, new RegExp(`\\\`${escapeRegExp(packageName)}\\\``));
	}

	for (const packageName of releaseSelectionNames("consumer-ready")) {
		assert.match(doc, new RegExp(`\\\`${escapeRegExp(packageName)}\\\``));
	}
});

test("package registry does not promise publication ahead of release policy", () => {
	assert.doesNotMatch(packageRegistryDoc, /Target v0\.1\.0/);
	assert.doesNotMatch(packageRegistryDoc, /READY FOR v0\.1\.0/);
	assert.match(packageRegistryDoc, /daily-driver gate/);
	assert.match(packageRegistryDoc, /kernel-candidates/);
	assert.match(packageRegistryDoc, /consumer-ready/);

	for (const packageName of releaseSelectionNames("default")) {
		assert.match(
			packageRegistryDoc,
			new RegExp(`\\[\\\`${escapeRegExp(packageName)}\\\``),
		);
	}

	for (const packageName of releaseSelectionNames("consumer-ready")) {
		assert.match(
			packageRegistryDoc,
			new RegExp(`\\[\\\`${escapeRegExp(packageName)}\\\``),
			`${packageName} must be listed in packages/README.md for the consumer-pulled lane`,
		);
	}
});

test("vault seed convergence keeps current handoff hashes in the manifest", () => {
	const currentHandoffSection = vaultSeedConvergenceDoc
		.split("**2026-06-30 full `vault-seed-ready` handoff:**")[1]
		.split("### Additional Assimilation Matrix")[0];

	assert.match(currentHandoffSection, /packages\[\]\.sha256/);
	assert.match(currentHandoffSection, /manifest\.json/);
	assert.match(currentHandoffSection, /manifest\.md/);
	assert.match(currentHandoffSection, /packages\[\]\.tarball/);
	assert.match(currentHandoffSection, /consumerInstall\.fileSpecs/);
	assert.match(currentHandoffSection, /consumerInstall\.pnpmOverrides/);
	assert.match(currentHandoffSection, /distributionEvidence/);
	assert.match(currentHandoffSection, /prunedExtra/);
	assert.doesNotMatch(currentHandoffSection, /\b[a-f0-9]{64}\b/);
});

test("cross-repo consumption uses the current vault-seed-ready packet", () => {
	assert.match(crossRepoConsumptionDoc, /consumer-ready/);
	assert.match(crossRepoConsumptionDoc, /release:first-publish:plan -- --selection consumer-ready --json/);
	assert.match(crossRepoConsumptionDoc, /--out \.refarm\/handoff\/vault-seed\/<YYYY-MM-DD>\/manifest\.json/);
	assert.match(crossRepoConsumptionDoc, /manifest\.json/);
	assert.match(crossRepoConsumptionDoc, /manifest\.md/);
	assert.match(crossRepoConsumptionDoc, /consumerInstall\.fileSpecs/);
	assert.match(crossRepoConsumptionDoc, /consumerInstall\.pnpmOverrides/);
	assert.match(crossRepoConsumptionDoc, /consumerProofs/);
	assert.match(crossRepoConsumptionDoc, /distributionEvidence\.currentRef/);
	assert.doesNotMatch(crossRepoConsumptionDoc, /`@refarm\.dev\/ds`, `\/homestead`, `\/silo`/);
});

test("vault-seed handoff docs distinguish historical 10-package packets from current selection", () => {
	const currentSelection = releaseSelectionNames("consumer-ready");
	// 24 since cc61342e: `@refarm.dev/vault-contract-v1` entered. This literal is the ANCHOR the
	// doc assertion derives from, so it is the one number that must be turned by hand — and the
	// commit that moved the fact did not turn it, nor the six others across three files.
	//
	// 23 again since 2026-08-16: content-projection rejoined the selection once vault-seed's
	// records reference vault actually consumed it. It was 23, then 22 under ISS-113's honest
	// correction, and 23 once more — which is exactly why the doc assertion below stopped being a
	// literal. A hardcoded `22-package` matched a doc that had gone stale and reported PASS: the
	// number is now DERIVED from the same selection this test measures, so the doc and the config
	// cannot disagree without failing.
	assert.equal(currentSelection.length, 25);

	assert.match(releaseGateDoc, new RegExp(`current\\s+${currentSelection.length}-package\\s+selection`));
	assert.match(releaseGateDoc, /materialized the then-current 10-package selection/);
	assert.match(
		releaseGateDoc,
		/ADR-072 superseded that packet before\s+publication/,
	);
	assert.match(vaultSeedHandoffPlan, /historical 2026-06-26/);
	assert.match(vaultSeedHandoffPlan, /active `vault-seed-ready` selection is\s+> now 23 packages and 72 required checks/);
	assert.match(vaultSeedHandoffAdr, /currently 23 packages tagged/);
	assert.match(vaultSeedHandoffAdr, /current accepted packet: 23 packages,\s+72 required checks/);
	assert.match(releasePolicyDoc, /selected 25-package publish plan/);
	assert.doesNotMatch(vaultSeedHandoffAdr, /currently 20 packages tagged/);
	assert.doesNotMatch(releasePolicyDoc, /selected 20-package publish plan/);
});

test("factory readiness records the current local vault-seed handoff state", () => {
	assert.match(factoryReadinessDoc, /official downstream proof received/);
	assert.match(factoryReadinessDoc, /\.refarm\/handoff\/vault-seed\/2026-07-03\/manifest\.json/);
	assert.match(factoryReadinessDoc, /distributionEvidence\.state: "local-handoff-ready"/);
	assert.match(factoryReadinessDoc, /23 tarballs/);
});

test("release convergence records the official downstream vault-seed proof receipt", () => {
	assert.match(releaseConvergencePlan, /Official `vault-seed` proof received/);
	assert.match(releaseConvergencePlan, /received from the official downstream checkout on 2026-07-03/);
	assert.match(releaseConvergencePlan, /packet: 21 tarballs, `manifest\.json`, `manifest\.md`/);
	assert.match(releaseConvergencePlan, /SHA-256 verification: all 21 `vendor\/\*\.tgz` files matched/);
	assert.match(releaseConvergencePlan, /focused consumer proof: 9 Vitest files \/ 33 tests passed/);
	assert.match(releaseConvergencePlan, /records:manifest` produced 93 valid records/);
	assert.match(releaseConvergencePlan, /Astro build passed with 86 pages/);
	assert.match(releaseConvergencePlan, /release:package:smoke:json` passed with `ok=true`/);
	assert.match(releaseConvergencePlan, /private POC specifics remain downstream/);

	assert.match(decisionLogDoc, /Official downstream proof received; publication gates still held/);
	assert.match(factoryReadinessDoc, /official downstream checkout reported successful vendor SHA-256 verification for the previous 21-tarball packet/);
	assert.match(factoryReadinessDoc, /4a `ds` tokens \| \*\*implemented \+ downstream-proven\*\*/);
	assert.match(factoryReadinessDoc, /4b `ds\/html` \| \*\*implemented \+ downstream-proven\*\*/);
	assert.match(dsTokenContractSpec, /official downstream `vault-seed` consumer proof received on 2026-07-03/);
	assert.match(vaultSeedConvergenceDoc, /official consumer checkout assimilated the manifest-bearing 21-tarball packet on 2026-07-03/);
	assert.match(releaseGateDoc, /the official downstream proof was received on 2026-07-03: the `vault-seed` Telegram adapter emits/);
	assert.match(releaseGateDoc, /the official downstream proof was received on 2026-07-03: `vault-seed` emits task artifact/);
	assert.match(releaseGateDoc, /official downstream proof verified the 2026-07-03 handoff tarballs and quality\/content\/site flows/);
	assert.match(releaseGateDoc, /consumer-proven in `consumer-ready`; public publish still waits on develop stabilization and release lane/);
	assert.match(releaseGateDoc, /Official `vault-seed` proof confirms `@aretw0\/dgk-runner` and `dgk-cli` import the SDK internally/);
	assert.match(processHandoffBridgeSpec, /IMPLEMENTED - downstream proof received; public publish waits on the release lane/);
	assert.match(processHandoffBridgeSpec, /official 2026-07-03 downstream proof confirms the runner and\s+CLI import the SDK internally/);
	assert.match(releaseGateDoc, /Official `vault-seed` proof confirms the publication outbox emits `refarm\.channel-delivery-envelope\.v1`/);
	assert.match(releaseGateDoc, /Official `vault-seed` proof emits a validated `refarm\.task-artifacts\.v1` manifest/);
	assert.match(vaultSeedConvergenceDoc, /Official proof received \(2026-07-03\): `vault-seed` now has `@aretw0\/dgk-runner`/);
	assert.match(vaultSeedConvergenceDoc, /Official proof received \(2026-07-03\): `vault-seed` now emits a\s+validated `refarm\.task-artifacts\.v1` manifest/);
	assert.match(vaultSeedConvergenceDoc, /Official proof received \(2026-07-03\): the `vault-seed` publication\s+outbox emits `refarm\.channel-delivery-envelope\.v1`/);
	assert.match(vaultSeedHandoffPlan, /Proof receipt \(2026-07-03\): the official `vault-seed` checkout later copied\s+> this previous 21-tarball packet, verified all 21 tarballs/);
	assert.match(dsTokenContractPlan, /Superseded proof note \(2026-07-03\): the official `vault-seed` checkout later\s+  assimilated the manifest-bearing 21-tarball packet/);
	assert.match(channelPolicyBridgePlan, /Official downstream proof received \(2026-07-03\): `vault-seed` emits the\s+  channel-delivery envelope/);
	assert.match(channelPolicyBridgeSpec, /IMPLEMENTED - downstream proof received; public publish waits on the release lane/);
	assert.match(channelPolicyBridgeSpec, /official 2026-07-03\s+  downstream proof confirms the neutral envelope is emitted/);
	assert.match(factoryReadinessDoc, /8b channel policy .* \| \*\*downstream-proven package slice\*\*/);
	assert.match(factoryReadinessDoc, /8c `process-handoff` \+ artifact provenance \| \*\*downstream-proven bridge slice\*\*/);
	assert.match(releaseGateDoc, /Official `vault-seed` proof confirms `silo\.js` now delegates publishing credentials to `SiloCore\.saveSecret/);
	assert.match(releaseGateDoc, /`@refarm\.dev\/local-surface` .* consumer-proven in `consumer-ready`; public publish still waits on develop stabilization and release lane/);
	assert.match(localSurfaceSpec, /Downstream proof received \(2026-07-03\): the official `vault-seed` checkout consumed a packed candidate tarball/);
	assert.match(packagesReadme, /`@refarm\.dev\/local-surface`.*consumer-proven; `consumer-ready`; held/);
	assert.match(vaultSeedSiloBridgeSpec, /IMPLEMENTED - downstream adapter proof received; public publish waits on the release lane/);
	assert.match(factoryReadinessDoc, /product adoption of the Silo-backed credential bridge remains downstream/);
	assert.match(artifactLabEvidencePlan, /Official downstream proof received \(2026-07-03\): `vault-seed` emits a\s+validated `refarm\.task-artifacts\.v1` manifest/);
	assert.doesNotMatch(factoryReadinessDoc, /downstream adoption proof remains consumer-side/);
	assert.doesNotMatch(factoryReadinessDoc, /official `vault-seed` assimilation remain pending/);
	assert.doesNotMatch(factoryReadinessDoc, /official 8b downstream envelope proof; official 8c `dgk-runner` manifest proof/);
	assert.doesNotMatch(factoryReadinessDoc, /Refarm-side package slice active/);
	assert.doesNotMatch(factoryReadinessDoc, /Refarm-side proof active/);
	assert.doesNotMatch(dsTokenContractSpec, /consumer proof in `vault-seed` remains external/);
	assert.doesNotMatch(vaultSeedConvergenceDoc, /official consumer checkout still needs to assimilate\/review that packet/);
	assert.doesNotMatch(releaseGateDoc, /official `vault-seed` assimilation pending/);
	assert.doesNotMatch(releaseGateDoc, /the official downstream proof remains the `vault-seed` Telegram adapter emitting/);
	assert.doesNotMatch(releaseGateDoc, /the official downstream proof remains `vault-seed` emitting task artifact/);
	assert.doesNotMatch(releaseGateDoc, /once the outside `vault-seed` checkout assimilates the validated packet/);
	assert.doesNotMatch(releaseGateDoc, /v0\.1 primitive once the outside `vault-seed` checkout emits the manifest proof/);
	assert.doesNotMatch(releaseGateDoc, /v0\.1 candidate once the outside `vault-seed` checkout emits the neutral envelope/);
	assert.doesNotMatch(releaseGateDoc, /artifact\/lab evidence.*v0\.1 candidate once the outside `vault-seed` checkout emits the manifest proof/);
	assert.doesNotMatch(processHandoffBridgeSpec, /ACTIVE - Refarm-side proof/);
	assert.doesNotMatch(processHandoffBridgeSpec, /until the downstream runner elects to import the SDK/);
	assert.doesNotMatch(vaultSeedConvergenceDoc, /The official `vault-seed` proof remains downstream: `@aretw0\/dgk-runner`/);
	assert.doesNotMatch(vaultSeedConvergenceDoc, /The official proof remains downstream: `vault-seed` should emit\s+`refarm\.task-artifacts\.v1` manifests/);
	assert.doesNotMatch(vaultSeedConvergenceDoc, /The official proof remains downstream: the `vault-seed` Telegram\s+adapter should emit/);
	assert.doesNotMatch(vaultSeedHandoffPlan, /downstream assimilation\s+> remains a handoff target, not a completed proof/);
	assert.doesNotMatch(dsTokenContractPlan, /Official `vault-seed` assimilation remains pending/);
	assert.doesNotMatch(channelPolicyBridgePlan, /Downstream proof remains pending until the official `vault-seed` checkout/);
	assert.doesNotMatch(channelPolicyBridgeSpec, /publication still waits on the first downstream proof/);
	assert.doesNotMatch(vaultSeedSiloBridgeSpec, /`vault-seed` adapter implementation pending/);
	assert.doesNotMatch(artifactLabEvidencePlan, /The official `vault-seed` checkout should emit `refarm\.task-artifacts\.v1`/);
});

test("focus maps do not regress implemented quality and projection blocks to planned", () => {
	// RATCHETED FORWARD 2026-08-16. This pinned three phrases that are now GONE from the focus doc,
	// and each was removed for a reason the ratchet should hold rather than resist:
	//
	//   "Phase 1 implemented, selected, and downstream-proven"  -> the claim was FALSE. The config
	//       said `candidate-hold` and the package's only caller anywhere was a contract test. The
	//       pin was protecting a sentence that overstated what had been measured.
	//   "Build the separate ds-astro render adapter over ds/html" -> that next step SHIPPED.
	//   "vault-seed MDX inventory now supplies render pressure for ds-astro" -> superseded by the
	//       stronger fact: vault-seed's reference vault now consumes content-projection itself.
	//
	// The pins below are the forward statements. A doc that walks any of them back to "planned",
	// "pending", or "downstream-proven" fails here, which is what the ratchet is for.
	assert.match(refarmWorkFocusDoc, /Implemented, selected, and consumer-proven/);
	assert.match(refarmWorkFocusDoc, /inline Markdown links into valid `records:v1`/);
	assert.match(refarmWorkFocusDoc, /records reference vault structures its MD\/MDX lane through it/);
	assert.match(refarmWorkFocusDoc, /`@refarm\.dev\/ds-astro` shipped/);
	assert.doesNotMatch(refarmWorkFocusDoc, /Content projection \/ MD-MDX authoring \| Designed, build-pending/);
	assert.doesNotMatch(refarmWorkFocusDoc, /Let the official consumer prove the handoff/);

	assert.match(convergenceRoadmapDoc, /phase 1 implemented: `@refarm\.dev\/content-projection`/);
	assert.match(convergenceRoadmapDoc, /official `vault-seed` render pressure received on 2026-07-03/);
	assert.doesNotMatch(convergenceRoadmapDoc, /plan \+ build pending/);

	assert.match(qualityAgentBuildOrderDoc, /ui adapter \*\*implemented\*\*: `@refarm\.dev\/ds\/quality-checker`/);
	assert.match(qualityAgentBuildOrderDoc, /wraps `ds-lint:v1` as a `quality:v1` `QualityChecker`/);
	assert.doesNotMatch(qualityAgentBuildOrderDoc, /adapter \*\*planned\*\*/);

	assert.match(decisionLogDoc, /Content-projection MD\/MDX blocks/);
	assert.match(decisionLogDoc, /`ds-astro` render pressure received from `vault-seed`, package plan next/);
	assert.doesNotMatch(decisionLogDoc, /Phase 1 implemented and selected; `ds-astro` remains render-pressure-gated/);
	assert.doesNotMatch(decisionLogDoc, /`ds-astro` remains render-pressure-gated/);
	// Superseded by the pin above: render pressure was the evidence that justified BUILDING
	// ds-astro. ds-astro is built, and the focus row now records consumption instead of pressure.
	assert.match(refarmWorkFocusDoc, /tarball vendored in `vault-seed`/);
	assert.doesNotMatch(decisionLogDoc, /Content-projection MD\/MDX blocks.*implementation in flight/);
});
