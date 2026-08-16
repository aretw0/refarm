import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	buildHandoffManifest,
	computeTransitiveRefarmClosure,
	formatHandoffMarkdown,
	packageTarballName,
	parseHandoffArgs,
	pruneExtraHandoffTarballs,
	writePacketManifests,
} from "../vault-seed-ready-handoff.mjs";

// The transitive @refarm.dev closure — the rope #2 fix: health -> config must be vendored + overridden
// without entering the consumer-proven selection.
test("computeTransitiveRefarmClosure: pulls a selected package's transitive @refarm.dev dep (health→config)", () => {
	const workspaceRefarmPackages = new Map([
		["@refarm.dev/health", "packages/health"],
		["@refarm.dev/config", "packages/config"],
		["@refarm.dev/storage-contract-v1", "packages/storage-contract-v1"],
	]);
	const deps = {
		"packages/health": ["@refarm.dev/config", "picomatch"],
		"packages/config": [],
		"packages/storage-contract-v1": [],
	};
	const closure = computeTransitiveRefarmClosure({
		selected: [
			{ packageName: "@refarm.dev/health", packageDir: "packages/health" },
			{ packageName: "@refarm.dev/storage-contract-v1", packageDir: "packages/storage-contract-v1" },
		],
		workspaceRefarmPackages,
		readDeps: (dir) => deps[dir] ?? [],
	});
	assert.deepEqual(closure, [{ packageName: "@refarm.dev/config", packageDir: "packages/config" }]);
});

test("computeTransitiveRefarmClosure: excludes already-selected deps, non-workspace deps, and recurses", () => {
	const workspaceRefarmPackages = new Map([
		["@refarm.dev/a", "packages/a"],
		["@refarm.dev/b", "packages/b"],
		["@refarm.dev/c", "packages/c"],
	]);
	const deps = {
		"packages/a": ["@refarm.dev/b", "@refarm.dev/c", "@refarm.dev/external-only"],
		"packages/b": ["@refarm.dev/c"], // recursion: b pulls c
		"packages/c": [],
	};
	const closure = computeTransitiveRefarmClosure({
		selected: [{ packageName: "@refarm.dev/a", packageDir: "packages/a" }],
		workspaceRefarmPackages, // b is selected below, external-only is not in the workspace map
		readDeps: (dir) => deps[dir] ?? [],
	}).map((entry) => entry.packageName);
	// a selects b transitively → but b IS a selected package here? no: only a is selected.
	// So b and c are both transitive; external-only is skipped (not a workspace package).
	assert.deepEqual(closure, ["@refarm.dev/b", "@refarm.dev/c"]);
});

const PROCESS_HANDOFF_CONSUMER_PULL = {
	proofId: "process-handoff.dgk-runner-adapter",
	downstreamUse: "Structured process runner primitive for dgk-runner and dgk-cli internals",
	proofTarget: "dgk-runner keeps run(cmd, args, opts) while using process-handoff internally",
	ownershipBoundary: "dgk package names, binary, commands, and product labels remain downstream",
};

const DS_CONSUMER_PULL = {
	proofId: "ds.lab-admin-static-document",
	downstreamUse: "Lab/admin tokens, verde-jardim theme source, and build-free DS HTML document helpers",
	proofTarget: "vault-seed Lab/admin UI imports ds tokens and renders documentHtml through @refarm.dev/ds/html without pulling Homestead",
	ownershipBoundary: "PARA vocabulary, editorial copy, and content semantics remain downstream",
};

function makeFixture() {
	const root = mkdtempSync(path.join(os.tmpdir(), "refarm-handoff-"));
	const handoffDir = path.join(root, ".refarm/handoff/vault-seed/fixture");
	mkdirSync(path.join(root, "packages/alpha"), { recursive: true });
	mkdirSync(path.join(root, "packages/beta"), { recursive: true });
	mkdirSync(handoffDir, { recursive: true });
	writeFileSync(
		path.join(root, "packages/alpha/package.json"),
		JSON.stringify({ name: "@refarm.dev/alpha", version: "0.1.0" }),
	);
	writeFileSync(
		path.join(root, "packages/beta/package.json"),
		JSON.stringify({ name: "@refarm.dev/beta", version: "0.2.0" }),
	);
	return { root, handoffDir };
}

function releaseCheck() {
	return {
		ok: true,
		plan: {
			ok: true,
			status: "ready",
			selection: { id: "consumer-ready" },
			orderedNames: ["@refarm.dev/alpha", "@refarm.dev/beta"],
			orderedPackages: [
				{
					name: "@refarm.dev/alpha",
					profile: {
						risk: "shared",
						tags: ["consumer-ready"],
						mustPassChecks: ["pnpm --filter @refarm.dev/alpha run test"],
					},
				},
				{
					name: "@refarm.dev/beta",
					profile: {
						risk: "core",
						tags: ["consumer-ready"],
						mustPassChecks: ["pnpm --filter @refarm.dev/beta run test"],
					},
				},
			],
			gates: [{ id: "preflight", required: true }],
			profileTags: ["consumer-ready"],
			publishIntents: [
				{ provider: "changesets", plan: { requiresManualApproval: true } },
			],
		},
		commands: [
			{
				packageName: "@refarm.dev/alpha",
				packageDir: "packages/alpha",
			},
			{
				packageName: "@refarm.dev/beta",
				packageDir: "packages/beta",
			},
		],
	};
}

test("derives npm pack tarball names for scoped packages", () => {
	assert.equal(
		packageTarballName("@refarm.dev/artifact-contract-v1", "0.1.0"),
		"refarm.dev-artifact-contract-v1-0.1.0.tgz",
	);
});

test("parses handoff CLI arguments", () => {
	assert.deepEqual(
		parseHandoffArgs([
			"--selection",
			"consumer-ready",
			"--dir",
			".refarm/handoff",
			"--out",
			"manifest.md",
			"--pack",
			"--prune-extra",
			"--",
			"--json",
		]),
		{
			selectionId: "consumer-ready",
			handoffDir: ".refarm/handoff",
			json: true,
			out: "manifest.md",
			pack: true,
			pruneExtra: true,
		},
	);
});

test("builds an ok manifest when every selected package has a tarball", () => {
	const { root, handoffDir } = makeFixture();
	writeFileSync(path.join(handoffDir, "refarm.dev-alpha-0.1.0.tgz"), "alpha");
	writeFileSync(path.join(handoffDir, "refarm.dev-beta-0.2.0.tgz"), "beta");

	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
		releaseCheck: releaseCheck(),
	});

	assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.source, "vault-seed-ready-handoff");
	assert.equal(manifest.ok, true);
	assert.deepEqual(manifest.acceptance, {
		status: "accepted",
		packageCount: 2,
		blockerCount: 0,
		requiredGateCount: 1,
		requiredCheckCount: 2,
		providerCount: 1,
		manualApprovalRequired: true,
		surfaces: ["core", "shared"],
		profileTags: ["consumer-ready"],
		requiredChecks: [
			{
				command: "pnpm --filter @refarm.dev/alpha run test",
				package: "@refarm.dev/alpha",
			},
			{
				command: "pnpm --filter @refarm.dev/beta run test",
				package: "@refarm.dev/beta",
			},
		],
	});
	assert.deepEqual(manifest.missing, []);
	assert.deepEqual(manifest.extra, []);
	assert.deepEqual(manifest.prunedExtra, []);
	assert.deepEqual(manifest.consumerProofs, []);
	assert.equal(manifest.releaseBoundaryAudit, null);
	assert.deepEqual(manifest.consumerInstall, {
		packageManager: "pnpm",
		vendorDir: "vendor",
		copyFrom: ".refarm/handoff/vault-seed/fixture",
		copyFiles: [
			"manifest.json",
			"refarm.dev-alpha-0.1.0.tgz",
			"refarm.dev-beta-0.2.0.tgz",
		],
		fileSpecs: {
			"@refarm.dev/alpha": "file:./vendor/refarm.dev-alpha-0.1.0.tgz",
			"@refarm.dev/beta": "file:./vendor/refarm.dev-beta-0.2.0.tgz",
		},
		pnpmOverrides: {
			"@refarm.dev/alpha": "file:./vendor/refarm.dev-alpha-0.1.0.tgz",
			"@refarm.dev/beta": "file:./vendor/refarm.dev-beta-0.2.0.tgz",
		},
		revendorPolicy: {
			sameNameVersionBehavior:
				"file: tarballs can keep the same package name and version while their bytes change during pre-publication handoff.",
			changedContentDetection: "compare packages[].sha256 against the consumer vendor tarball and lockfile integrity",
			requiredWhenShaChanges: [
				"replace the matching vendor/*.tgz file from the same handoff directory",
				"refresh the package-manager lockfile entry for the changed file: tarball",
				"if the package manager keeps the old bytes, reinstall from a clean node_modules before running consumer proofs",
			],
			proofAfterRefresh: "consumerProofs",
		},
		proofChecklist: "consumerProofs",
	});
	assert.equal(manifest.distributionEvidence.schema, "refarm.vault-seed-ready-distribution-evidence.v1");
	assert.equal(manifest.distributionEvidence.state, "local-handoff-ready");
	assert.equal(manifest.distributionEvidence.stableRef, "refarm-handoff://vault-seed-ready");
	assert.equal(
		manifest.distributionEvidence.currentRef,
		"refarm-handoff://vault-seed-ready/fixture",
	);
	assert.equal(manifest.distributionEvidence.subject.selectionId, "consumer-ready");
	assert.deepEqual(manifest.distributionEvidence.subject.tarballs, [
		"refarm.dev-alpha-0.1.0.tgz",
		"refarm.dev-beta-0.2.0.tgz",
	]);
	assert.equal(manifest.distributionEvidence.availability.currentVerifiedCopies, 1);
	assert.equal(manifest.distributionEvidence.update.source, "release-engine");
	assert.equal(manifest.distributionEvidence.rollback.requiresHumanApproval, true);
	assert.equal(manifest.distributionEvidence.boundary.publicInstallContract, false);
	assert.equal(manifest.distributionEvidence.boundary.p2pSubstrateAdopted, false);
	assert.equal(manifest.distributionEvidence.boundary.releaseBoundaryAudit, null);
	assert.deepEqual(manifest.distributionEvidence.update.evidenceRefs, [
		"acceptance",
		"packages[].sha256",
		"consumerProofs",
		"consumerInstall.revendorPolicy",
	]);
	assert.equal(manifest.packages[0].consumerPull, null);
	assert.equal(manifest.packages[0].stale, false);
	assert.equal(manifest.packages[0].buildOutputStale, false);
	assert.equal(manifest.packages[0].sourceInput.path, path.join("packages", "alpha", "package.json"));
	assert.equal(manifest.packages[0].sha256, "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8");
	assert.match(formatHandoffMarkdown(manifest), /refarm\.dev-alpha-0\.1\.0\.tgz/);
	assert.match(
		formatHandoffMarkdown(manifest),
		/Acceptance: accepted \(2 package\(s\), 2 required check\(s\)\)/,
	);
	assert.match(formatHandoffMarkdown(manifest), /Distribution evidence:/);
	assert.match(formatHandoffMarkdown(manifest), /refarm-handoff:\/\/vault-seed-ready\/fixture/);
	assert.match(formatHandoffMarkdown(manifest), /none declared/);
	assert.match(formatHandoffMarkdown(manifest), /Consumer install hints:/);
	assert.match(formatHandoffMarkdown(manifest), /consumerInstall\.pnpmOverrides/);
	assert.match(formatHandoffMarkdown(manifest), /consumerInstall\.revendorPolicy/);
});

test("stamps manifest provenance: generatedAt ISO timestamp and git SHA (null outside a git repo)", () => {
	const { root, handoffDir } = makeFixture();
	writeFileSync(path.join(handoffDir, "refarm.dev-alpha-0.1.0.tgz"), "alpha");
	writeFileSync(path.join(handoffDir, "refarm.dev-beta-0.2.0.tgz"), "beta");

	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
		releaseCheck: releaseCheck(),
	});

	assert.ok(
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(manifest.generatedAt),
		`generatedAt should be an ISO timestamp, got: ${manifest.generatedAt}`,
	);
	// The fixture root is a temp dir, not a git checkout.
	assert.equal(manifest.sourceGitSha, null);
});

test("writes manifest.json and manifest.md beside the packet tarballs", () => {
	const { root, handoffDir } = makeFixture();
	writeFileSync(path.join(handoffDir, "refarm.dev-alpha-0.1.0.tgz"), "alpha");
	writeFileSync(path.join(handoffDir, "refarm.dev-beta-0.2.0.tgz"), "beta");

	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
		releaseCheck: releaseCheck(),
	});
	const { jsonPath, markdownPath } = writePacketManifests({
		cwd: root,
		handoffDir,
		manifest,
	});

	assert.equal(jsonPath, path.join(handoffDir, "manifest.json"));
	assert.equal(markdownPath, path.join(handoffDir, "manifest.md"));
	assert.ok(existsSync(jsonPath));
	assert.ok(existsSync(markdownPath));

	// The written packet manifest must not invalidate its own directory:
	// a rebuild over the same dir still reports ok (only .tgz files are audited).
	const rebuilt = buildHandoffManifest({
		cwd: root,
		handoffDir,
		releaseCheck: releaseCheck(),
	});
	assert.equal(rebuilt.ok, true);
});

test("adds consumer-pull proof metadata for vault-seed-ready packages", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "refarm-handoff-"));
	const handoffDir = path.join(root, ".refarm/handoff/vault-seed/fixture");
	mkdirSync(path.join(root, "packages/process-handoff"), { recursive: true });
	mkdirSync(handoffDir, { recursive: true });
	writeFileSync(
		path.join(root, "packages/process-handoff/package.json"),
		JSON.stringify({ name: "@refarm.dev/process-handoff", version: "0.1.0" }),
	);
	writeFileSync(
		path.join(handoffDir, "refarm.dev-process-handoff-0.1.0.tgz"),
		"launch",
	);

	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
		releaseCheck: {
			ok: true,
			plan: {
				ok: true,
				status: "ready",
				selection: { id: "consumer-ready" },
				orderedNames: ["@refarm.dev/process-handoff"],
				orderedPackages: [
					{
						name: "@refarm.dev/process-handoff",
							profile: {
								risk: "shared",
								tags: ["consumer-ready"],
								mustPassChecks: ["pnpm --filter @refarm.dev/process-handoff run test"],
								consumerPull: PROCESS_HANDOFF_CONSUMER_PULL,
							},
						},
					],
				gates: [{ id: "preflight", required: true }],
				profileTags: ["consumer-ready"],
				publishIntents: [],
			},
			commands: [
				{
					packageName: "@refarm.dev/process-handoff",
					packageDir: "packages/process-handoff",
				},
			],
		},
	});

	assert.equal(manifest.ok, true);
	assert.deepEqual(manifest.packages[0].consumerPull, PROCESS_HANDOFF_CONSUMER_PULL);
	assert.deepEqual(manifest.consumerProofs, [
		{
			proofId: "process-handoff.dgk-runner-adapter",
			packageName: "@refarm.dev/process-handoff",
			downstreamUse: "Structured process runner primitive for dgk-runner and dgk-cli internals",
			proofTarget: "dgk-runner keeps run(cmd, args, opts) while using process-handoff internally",
			ownershipBoundary: "dgk package names, binary, commands, and product labels remain downstream",
		},
	]);
	assert.match(
		formatHandoffMarkdown(manifest),
		/dgk-runner keeps run\(cmd, args, opts\) while using process-handoff internally/,
	);
	assert.match(formatHandoffMarkdown(manifest), /process-handoff\.dgk-runner-adapter/);
	assert.match(formatHandoffMarkdown(manifest), /Consumer proofs:/);
});

test("uses document wording for ds/html consumer-pull metadata", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "refarm-handoff-"));
	const handoffDir = path.join(root, ".refarm/handoff/vault-seed/fixture");
	mkdirSync(path.join(root, "packages/ds"), { recursive: true });
	mkdirSync(handoffDir, { recursive: true });
	writeFileSync(
		path.join(root, "packages/ds/package.json"),
		JSON.stringify({ name: "@refarm.dev/ds", version: "0.1.0" }),
	);
	writeFileSync(path.join(handoffDir, "refarm.dev-ds-0.1.0.tgz"), "ds");

	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
		releaseCheck: {
			ok: true,
			plan: {
				ok: true,
				status: "ready",
				selection: { id: "consumer-ready" },
				orderedNames: ["@refarm.dev/ds"],
				orderedPackages: [
					{
						name: "@refarm.dev/ds",
							profile: {
								risk: "shared",
								tags: ["consumer-ready"],
								mustPassChecks: ["pnpm --filter @refarm.dev/ds run test"],
								consumerPull: DS_CONSUMER_PULL,
							},
						},
					],
				gates: [{ id: "preflight", required: true }],
				profileTags: ["consumer-ready"],
				publishIntents: [],
			},
			commands: [
				{
					packageName: "@refarm.dev/ds",
					packageDir: "packages/ds",
				},
			],
		},
	});

	assert.equal(manifest.packages[0].consumerPull.proofId, "ds.lab-admin-static-document");
	assert.match(manifest.packages[0].consumerPull.downstreamUse, /document helpers/);
	assert.match(manifest.packages[0].consumerPull.proofTarget, /documentHtml/);
	assert.doesNotMatch(formatHandoffMarkdown(manifest), /html-shell|HTML shell|shell helpers/);
});

test("keeps blocked distribution evidence at zero verified copies", () => {
	const { root, handoffDir } = makeFixture();
	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
		releaseCheck: {
			ok: false,
			plan: {
				ok: false,
				status: "blocked",
				selection: { id: "consumer-ready" },
				reason: "release selection is not ready",
				orderedNames: [],
				orderedPackages: [],
				blockers: [],
				gates: [],
				publishIntents: [],
			},
		},
	});

	assert.equal(manifest.ok, false);
	assert.deepEqual(manifest.packages, []);
	assert.equal(manifest.distributionEvidence.state, "blocked");
	assert.equal(manifest.distributionEvidence.availability.currentVerifiedCopies, 0);
	assert.deepEqual(manifest.distributionEvidence.issues, ["release selection is not ready"]);
});

test("blocks manifest when release boundary audit fails", () => {
	const { root, handoffDir } = makeFixture();
	writeFileSync(path.join(handoffDir, "refarm.dev-alpha-0.1.0.tgz"), "alpha");
	writeFileSync(path.join(handoffDir, "refarm.dev-beta-0.2.0.tgz"), "beta");

	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
		releaseCheck: releaseCheck(),
		releaseBoundaryAudit: {
			schemaVersion: 1,
			command: "release-boundary-audit",
			ok: false,
			selectionId: "consumer-ready",
			auditedPackageCount: 2,
			auditedPackages: ["@refarm.dev/alpha", "@refarm.dev/beta"],
			issueCount: 1,
			issues: [
				{
					code: "README_OPENING_PRODUCT_SPECIFIC",
					packageName: "@refarm.dev/alpha",
					message: "README opening should describe reusable capability.",
				},
			],
		},
	});

	assert.equal(manifest.ok, false);
	assert.deepEqual(manifest.issues, [
		"release boundary audit README_OPENING_PRODUCT_SPECIFIC: README opening should describe reusable capability.",
	]);
	assert.equal(manifest.distributionEvidence.state, "blocked");
	assert.equal(manifest.distributionEvidence.boundary.releaseBoundaryAudit.ok, false);
	assert.deepEqual(
		manifest.distributionEvidence.update.evidenceRefs,
		["acceptance", "packages[].sha256", "consumerProofs", "consumerInstall.revendorPolicy", "releaseBoundaryAudit"],
	);
	assert.match(formatHandoffMarkdown(manifest), /Release boundary audit:/);
	assert.match(formatHandoffMarkdown(manifest), /README_OPENING_PRODUCT_SPECIFIC/);
});

test("keeps current vault-seed-ready selection tied to consumer-pull metadata", () => {
	const root = process.cwd();
	const handoffDir = mkdtempSync(path.join(os.tmpdir(), "refarm-handoff-empty-"));

	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
	});

	assert.equal(manifest.selection.id, "consumer-ready");
	// 23 since 2026-08-16: `@refarm.dev/content-projection` REJOINED the `consumer-ready`
	// selection. ISS-113 held it out at 22 because nothing declared a dependency on it, and refused
	// to stamp `consumer-proven` to make a test green. The bar its three profile peers meet is a
	// consumer reaching the package from a surface that is NOT the contract test, and vault-seed's
	// records reference vault now structures its MD/MDX lane through `projectContentToRecords`.
	// The tag moved because the fact moved — not to make this number move.
	assert.equal(manifest.packages.length, 23);
	assert.ok(manifest.packages.some((pkg) => pkg.packageName === "@refarm.dev/health"));
	assert.equal(manifest.consumerProofs.length, manifest.packages.length);
	assert.ok(manifest.consumerProofs.some((proof) => proof.proofId === "health.toolchain-environment-auditor"));
	assert.equal(manifest.distributionEvidence.state, "blocked");
	assert.equal(manifest.distributionEvidence.availability.currentVerifiedCopies, 0);
	assert.equal(manifest.distributionEvidence.subject.packageCount, 23);
	assert.equal(manifest.distributionEvidence.integrity.tarballs.length, 23);
	assert.equal(manifest.releaseBoundaryAudit.ok, true);
	assert.equal(manifest.releaseBoundaryAudit.command, "release-boundary-audit");
	assert.equal(manifest.releaseBoundaryAudit.selectionId, "consumer-ready");
	assert.equal(manifest.releaseBoundaryAudit.auditedPackageCount, manifest.packages.length);
	assert.equal(manifest.distributionEvidence.boundary.releaseBoundaryAudit.ok, true);
	assert.equal(
		manifest.distributionEvidence.boundary.releaseBoundaryAudit.command,
		"release-boundary-audit",
	);
	assert.deepEqual(
		manifest.distributionEvidence.update.evidenceRefs,
		[
			"acceptance",
			"packages[].sha256",
			"consumerProofs",
			"consumerInstall.revendorPolicy",
			"releaseBoundaryAudit",
		],
	);
	assert.equal(Object.keys(manifest.consumerInstall.fileSpecs).length, manifest.packages.length);
	// pnpmOverrides ⊇ fileSpecs — it adds the transitive @refarm.dev closure (e.g. health → config)
	// so the consumer's install is dependency-closed; copyFiles carries every overridden tarball + manifest.
	for (const key of Object.keys(manifest.consumerInstall.fileSpecs)) {
		assert.ok(key in manifest.consumerInstall.pnpmOverrides);
	}
	assert.ok(Object.keys(manifest.consumerInstall.pnpmOverrides).length >= manifest.packages.length);
	assert.equal(
		manifest.consumerInstall.copyFiles.length,
		Object.keys(manifest.consumerInstall.pnpmOverrides).length + 1,
	);
	assert.equal(manifest.consumerInstall.revendorPolicy.proofAfterRefresh, "consumerProofs");
	assert.equal(
		manifest.consumerInstall.fileSpecs["@refarm.dev/ds"],
		"file:./vendor/refarm.dev-ds-0.1.0.tgz",
	);
	assert.equal(
		manifest.consumerInstall.fileSpecs["@refarm.dev/ds-astro"],
		"file:./vendor/refarm.dev-ds-astro-0.1.0.tgz",
	);
	assert.equal(
		manifest.consumerInstall.pnpmOverrides["@refarm.dev/heartwood"],
		"file:./vendor/refarm.dev-heartwood-0.1.0.tgz",
	);
	assert.equal(
		manifest.consumerInstall.fileSpecs["@refarm.dev/credentials-contract-v1"],
		"file:./vendor/refarm.dev-credentials-contract-v1-0.1.0.tgz",
	);
	assert.equal(
		manifest.consumerInstall.pnpmOverrides["@refarm.dev/storage-memory"],
		"file:./vendor/refarm.dev-storage-memory-0.1.0.tgz",
	);
	assert.ok(
		manifest.consumerProofs.some((proof) =>
			proof.proofId === "credentials-contract.issue-verify-present-wallet"),
		"credentials consumer proof metadata must be present",
	);
	assert.ok(
		manifest.consumerProofs.some(
			(proof) => proof.proofId === "ds-astro.mdx-render-adapter",
		),
		"ds-astro consumer proof metadata must be present",
	);
	assert.equal(
		new Set(manifest.consumerProofs.map((proof) => proof.proofId)).size,
		manifest.consumerProofs.length,
	);
	assert.match(formatHandoffMarkdown(manifest), /Release boundary audit:/);
	assert.match(formatHandoffMarkdown(manifest), /release-boundary-audit/);
	assert.deepEqual(
		manifest.packages
			.filter((entry) => entry.consumerPull === null)
			.map((entry) => entry.packageName),
		[],
	);
});

test("reports missing and extra handoff tarballs", () => {
	const { root, handoffDir } = makeFixture();
	writeFileSync(path.join(handoffDir, "refarm.dev-alpha-0.1.0.tgz"), "alpha");
	writeFileSync(path.join(handoffDir, "unexpected-0.1.0.tgz"), "extra");

	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
		releaseCheck: releaseCheck(),
	});

	assert.equal(manifest.ok, false);
	assert.deepEqual(manifest.missing, ["refarm.dev-beta-0.2.0.tgz"]);
	assert.deepEqual(manifest.extra, ["unexpected-0.1.0.tgz"]);
	assert.deepEqual(manifest.issues, [
		"missing expected tarball: refarm.dev-beta-0.2.0.tgz",
		"unexpected tarball: unexpected-0.1.0.tgz",
	]);
	assert.equal(manifest.distributionEvidence.state, "blocked");
	assert.deepEqual(manifest.distributionEvidence.issues, manifest.issues);
	assert.equal(manifest.distributionEvidence.availability.currentVerifiedCopies, 0);
});

test("prunes only unexpected handoff tarballs", () => {
	const { root, handoffDir } = makeFixture();
	const alphaTarball = path.join(handoffDir, "refarm.dev-alpha-0.1.0.tgz");
	const betaTarball = path.join(handoffDir, "refarm.dev-beta-0.2.0.tgz");
	const unexpectedTarball = path.join(handoffDir, "unexpected-0.1.0.tgz");
	writeFileSync(alphaTarball, "alpha");
	writeFileSync(betaTarball, "beta");
	writeFileSync(unexpectedTarball, "extra");

	const pruned = pruneExtraHandoffTarballs({
		cwd: root,
		handoffDir,
		releaseCheck: releaseCheck(),
	});

	assert.deepEqual(pruned, ["unexpected-0.1.0.tgz"]);
	assert.equal(existsSync(alphaTarball), true);
	assert.equal(existsSync(betaTarball), true);
	assert.equal(existsSync(unexpectedTarball), false);
	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
		prunedExtra: pruned,
		releaseCheck: releaseCheck(),
	});
	assert.equal(manifest.ok, true);
	assert.deepEqual(manifest.prunedExtra, ["unexpected-0.1.0.tgz"]);
	assert.match(formatHandoffMarkdown(manifest), /Pruned generated extras:/);
	assert.match(formatHandoffMarkdown(manifest), /unexpected-0\.1\.0\.tgz/);
});

test("reports stale handoff tarballs when package inputs are newer", () => {
	const { root, handoffDir } = makeFixture();
	const tarballPath = path.join(handoffDir, "refarm.dev-alpha-0.1.0.tgz");
	const packageJsonPath = path.join(root, "packages/alpha/package.json");
	const readmePath = path.join(root, "packages/alpha/README.md");
	writeFileSync(tarballPath, "alpha");
	writeFileSync(path.join(handoffDir, "refarm.dev-beta-0.2.0.tgz"), "beta");
	writeFileSync(readmePath, "# Alpha\n");

	const oldTime = new Date("2026-01-01T00:00:00.000Z");
	const newTime = new Date("2026-01-02T00:00:00.000Z");
	utimesSync(tarballPath, oldTime, oldTime);
	utimesSync(packageJsonPath, oldTime, oldTime);
	utimesSync(readmePath, newTime, newTime);

	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
		releaseCheck: releaseCheck(),
	});

	assert.equal(manifest.ok, false);
	assert.equal(manifest.packages[0].stale, true);
	assert.deepEqual(manifest.missing, []);
	assert.deepEqual(manifest.extra, []);
	assert.deepEqual(manifest.issues, [
		`stale tarball: refarm.dev-alpha-0.1.0.tgz is older than ${path.join("packages", "alpha", "README.md")}`,
	]);
	assert.match(formatHandoffMarkdown(manifest), /stale tarball: refarm\.dev-alpha-0\.1\.0\.tgz/);
});

test("reports stale build outputs before accepting fresh tarballs", () => {
	const { root, handoffDir } = makeFixture();
	const packageDir = path.join(root, "packages/alpha");
	const packageJsonPath = path.join(packageDir, "package.json");
	const tarballPath = path.join(handoffDir, "refarm.dev-alpha-0.1.0.tgz");
	const sourcePath = path.join(packageDir, "src/index.ts");
	const outputPath = path.join(packageDir, "dist/index.js");
	writeFileSync(
		packageJsonPath,
		JSON.stringify({
			name: "@refarm.dev/alpha",
			version: "0.1.0",
			main: "./dist/index.js",
			files: ["dist"],
		}),
	);
	mkdirSync(path.dirname(sourcePath), { recursive: true });
	mkdirSync(path.dirname(outputPath), { recursive: true });
	writeFileSync(sourcePath, "export const value = 1;\n");
	writeFileSync(outputPath, "export const value = 0;\n");
	writeFileSync(tarballPath, "alpha");
	writeFileSync(path.join(handoffDir, "refarm.dev-beta-0.2.0.tgz"), "beta");

	const oldTime = new Date("2026-01-01T00:00:00.000Z");
	const newTime = new Date("2026-01-02T00:00:00.000Z");
	utimesSync(packageJsonPath, oldTime, oldTime);
	utimesSync(outputPath, oldTime, oldTime);
	utimesSync(sourcePath, newTime, newTime);
	utimesSync(tarballPath, newTime, newTime);

	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
		releaseCheck: releaseCheck(),
	});

	assert.equal(manifest.ok, false);
	assert.equal(manifest.packages[0].stale, false);
	assert.equal(manifest.packages[0].buildOutputStale, true);
	assert.deepEqual(manifest.issues, [
		`stale build output: @refarm.dev/alpha output ${path.join("packages", "alpha", "dist", "index.js")} is older than ${path.join("packages", "alpha", "src", "index.ts")}`,
	]);
});
