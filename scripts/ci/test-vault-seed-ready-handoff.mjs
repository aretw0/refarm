import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
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
	assert.deepEqual(manifest.consumerProofs, []);
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
	assert.match(formatHandoffMarkdown(manifest), /none declared/);
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
				selection: { id: "vault-seed-ready" },
				orderedNames: ["@refarm.dev/process-handoff"],
				orderedPackages: [
					{
						name: "@refarm.dev/process-handoff",
						profile: {
							risk: "shared",
							tags: ["vault-seed-ready"],
							mustPassChecks: ["pnpm --filter @refarm.dev/process-handoff run test"],
						},
					},
				],
				gates: [{ id: "preflight", required: true }],
				profileTags: ["vault-seed-ready"],
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
	assert.deepEqual(manifest.packages[0].consumerPull, {
		proofId: "process-handoff.dgk-runner-adapter",
		downstreamUse: "Structured process runner primitive for dgk-runner and dgk-cli internals",
		proofTarget: "dgk-runner keeps run(cmd, args, opts) while using process-handoff internally",
		ownershipBoundary: "dgk package names, binary, commands, and product labels remain downstream",
	});
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

test("keeps current vault-seed-ready selection tied to consumer-pull metadata", () => {
	const root = process.cwd();
	const handoffDir = mkdtempSync(path.join(os.tmpdir(), "refarm-handoff-empty-"));

	const manifest = buildHandoffManifest({
		cwd: root,
		handoffDir,
	});

	assert.equal(manifest.selection.id, "vault-seed-ready");
	assert.equal(manifest.packages.length, 9);
	assert.equal(manifest.consumerProofs.length, manifest.packages.length);
	assert.equal(
		new Set(manifest.consumerProofs.map((proof) => proof.proofId)).size,
		manifest.consumerProofs.length,
	);
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
