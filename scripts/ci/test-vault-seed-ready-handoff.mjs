import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	buildHandoffManifest,
	formatHandoffMarkdown,
	packageTarballName,
	parseHandoffArgs,
} from "../vault-seed-ready-handoff.mjs";

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
			selection: { id: "vault-seed-ready" },
			orderedNames: ["@refarm.dev/alpha", "@refarm.dev/beta"],
			orderedPackages: [
				{
					name: "@refarm.dev/alpha",
					profile: {
						risk: "shared",
						tags: ["vault-seed-ready"],
						mustPassChecks: ["pnpm --filter @refarm.dev/alpha run test"],
					},
				},
				{
					name: "@refarm.dev/beta",
					profile: {
						risk: "core",
						tags: ["vault-seed-ready"],
						mustPassChecks: ["pnpm --filter @refarm.dev/beta run test"],
					},
				},
			],
			gates: [{ id: "preflight", required: true }],
			profileTags: ["vault-seed-ready"],
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
			"vault-seed-ready",
			"--dir",
			".refarm/handoff",
			"--out",
			"manifest.md",
			"--pack",
			"--",
			"--json",
		]),
		{
			selectionId: "vault-seed-ready",
			handoffDir: ".refarm/handoff",
			json: true,
			out: "manifest.md",
			pack: true,
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
		profileTags: ["vault-seed-ready"],
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
	assert.equal(manifest.packages[0].sha256, "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8");
	assert.match(formatHandoffMarkdown(manifest), /refarm\.dev-alpha-0\.1\.0\.tgz/);
	assert.match(
		formatHandoffMarkdown(manifest),
		/Acceptance: accepted \(2 package\(s\), 2 required check\(s\)\)/,
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
});
