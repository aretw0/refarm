import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	latestAcceptedHandoffReport,
	parseArgs,
	validateHandoffManifest,
} from "./vault-seed-handoff-consumer-install.mjs";

function fixture() {
	const root = mkdtempSync(path.join(os.tmpdir(), "refarm-consumer-install-"));
	const handoffDir = path.join(root, ".refarm/handoff/vault-seed/fixture");
	mkdirSync(handoffDir, { recursive: true });

	const alphaTarball = "refarm.dev-alpha-0.1.0.tgz";
	const betaTarball = "refarm.dev-beta-0.1.0.tgz";
	writeFileSync(path.join(handoffDir, alphaTarball), "alpha");
	writeFileSync(path.join(handoffDir, betaTarball), "beta");

	const manifest = {
		source: "vault-seed-ready-handoff",
		sourceGitSha: "abc123",
		ok: true,
		status: "ready",
		selection: { id: "consumer-ready" },
		acceptance: { status: "accepted", packageCount: 2 },
		packages: [
			{
				packageName: "@refarm.dev/alpha",
				version: "0.1.0",
				tarball: alphaTarball,
				sha256: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8",
				sizeBytes: 5,
			},
			{
				packageName: "@refarm.dev/beta",
				version: "0.1.0",
				tarball: betaTarball,
				sha256: "f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753",
				sizeBytes: 4,
			},
		],
		consumerInstall: {
			copyFiles: ["manifest.json", alphaTarball, betaTarball],
			fileSpecs: {
				"@refarm.dev/alpha": `file:./vendor/${alphaTarball}`,
				"@refarm.dev/beta": `file:./vendor/${betaTarball}`,
			},
			pnpmOverrides: {
				"@refarm.dev/alpha": `file:./vendor/${alphaTarball}`,
				"@refarm.dev/beta": `file:./vendor/${betaTarball}`,
			},
		},
		distributionEvidence: {
			integrity: {
				tarballs: [
					{
						packageName: "@refarm.dev/alpha",
						version: "0.1.0",
						tarball: alphaTarball,
						sha256: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8",
					},
					{
						packageName: "@refarm.dev/beta",
						version: "0.1.0",
						tarball: betaTarball,
						sha256: "f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753",
					},
				],
			},
		},
	};
	writeFileSync(path.join(handoffDir, "manifest.json"), JSON.stringify(manifest, null, 2));

	return { root, handoffDir, alphaTarball, betaTarball };
}

test("validates a packed vault-seed-ready handoff manifest", () => {
	const { root, handoffDir } = fixture();
	const report = validateHandoffManifest({ root, handoffDir });

	assert.equal(report.ok, true);
	assert.equal(report.packageCount, 2);
	assert.equal(report.sourceGitSha, "abc123");
	assert.deepEqual(report.issues, []);
});

test("detects corrupted tarballs and consumerInstall drift", () => {
	const { root, handoffDir } = fixture();
	const manifestPath = path.join(handoffDir, "manifest.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.consumerInstall.pnpmOverrides["@refarm.dev/beta"] = "file:./vendor/wrong.tgz";
	manifest.distributionEvidence.integrity.tarballs[0].sha256 = "bad";
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	writeFileSync(path.join(handoffDir, "refarm.dev-alpha-0.1.0.tgz"), "changed");

	const report = validateHandoffManifest({ root, handoffDir });

	assert.equal(report.ok, false);
	assert.deepEqual(
		report.issues.map((item) => item.code).sort(),
		["distribution-integrity", "pnpm-override", "tarball-sha256", "tarball-size"],
	);
});

test("validates a downstream vendor copy when supplied", () => {
	const { root, handoffDir, alphaTarball, betaTarball } = fixture();
	const consumerRoot = path.join(root, "consumer");
	mkdirSync(path.join(consumerRoot, "vendor"), { recursive: true });
	writeFileSync(path.join(consumerRoot, "vendor", alphaTarball), "alpha");
	writeFileSync(path.join(consumerRoot, "vendor", betaTarball), "wrong");
	writeFileSync(
		path.join(consumerRoot, "package.json"),
		JSON.stringify({
			dependencies: {
				"@refarm.dev/alpha": `file:vendor/${alphaTarball}`,
			},
		}),
	);
	writeFileSync(
		path.join(consumerRoot, "pnpm-workspace.yaml"),
		[
			"overrides:",
			`  "@refarm.dev/alpha": "file:vendor/${alphaTarball}"`,
		].join("\n"),
	);

	const report = validateHandoffManifest({ root, handoffDir, consumerRoot });

	assert.equal(report.ok, false);
	assert.deepEqual(
		report.issues.map((item) => item.code).sort(),
		["consumer-pnpm-override", "consumer-vendor-sha256"],
	);
});

test("validates only the packages a downstream consumer actually copied", () => {
	const { root, handoffDir, alphaTarball } = fixture();
	const consumerRoot = path.join(root, "consumer");
	mkdirSync(path.join(consumerRoot, "vendor"), { recursive: true });
	writeFileSync(path.join(consumerRoot, "vendor", alphaTarball), "alpha");
	writeFileSync(
		path.join(consumerRoot, "package.json"),
		JSON.stringify({
			dependencies: {
				"@refarm.dev/alpha": `file:vendor/${alphaTarball}`,
				"@refarm.dev/another-proof": "file:vendor/another-proof.tgz",
			},
		}),
	);
	writeFileSync(
		path.join(consumerRoot, "pnpm-workspace.yaml"),
		[
			"overrides:",
			`  "@refarm.dev/alpha": "file:vendor/${alphaTarball}"`,
		].join("\n"),
	);

	const report = validateHandoffManifest({
		root,
		handoffDir,
		consumerRoot,
		consumerPackages: ["@refarm.dev/alpha"],
	});

	assert.equal(report.ok, true);
	assert.equal(report.consumerPackageCount, 1);
	assert.deepEqual(report.consumerPackages, ["@refarm.dev/alpha"]);
});

test("rejects an explicitly requested consumer package absent from the handoff", () => {
	const { root, handoffDir } = fixture();
	const report = validateHandoffManifest({
		root,
		handoffDir,
		consumerPackages: ["@refarm.dev/missing"],
	});

	assert.equal(report.ok, false);
	assert.deepEqual(report.issues.map((item) => item.code), ["consumer-package-unknown"]);
});

test("parses repeatable focused consumer packages", () => {
	const options = parseArgs([
		"--consumer-root",
		"/tmp/consumer",
		"--consumer-package",
		"@refarm.dev/ds",
		"--consumer-package",
		"@refarm.dev/quality-contract-v1",
	]);

	assert.deepEqual(options.consumerPackages, [
		"@refarm.dev/ds",
		"@refarm.dev/quality-contract-v1",
	]);
});

test("latest-accepted mode skips a newer blocked candidate", () => {
	const accepted = fixture();
	const blockedDir = path.join(accepted.root, ".refarm/handoff/vault-seed/zz-blocked");
	mkdirSync(blockedDir, { recursive: true });
	writeFileSync(path.join(blockedDir, "manifest.json"), JSON.stringify({
		source: "vault-seed-ready-handoff",
		sourceGitSha: "blocked",
		ok: false,
		status: "ready",
		selection: { id: "consumer-ready" },
		acceptance: { status: "accepted", packageCount: 0 },
		packages: [],
		consumerInstall: { copyFiles: ["manifest.json"], fileSpecs: {}, pnpmOverrides: {} },
		distributionEvidence: { integrity: { tarballs: [] } },
		issues: ["stale build output: @refarm.dev/example"],
	}, null, 2));

	const report = latestAcceptedHandoffReport({ root: accepted.root });

	assert.equal(report.ok, true);
	assert.equal(report.mode, "latest-accepted");
	assert.equal(report.handoffDir, accepted.handoffDir);
	assert.equal(report.latestCandidate.ok, false);
	assert.equal(report.latestCandidate.sourceGitSha, "blocked");
	assert.equal(report.latestCandidate.issueCount, 2);
});
