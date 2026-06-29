import assert from "node:assert/strict";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { generateVault } from "../../generators/vault-seed/generate.mjs";
import { buildReleaseCheckPlan } from "../release-check.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
	readFileSync(path.join(repoRoot, "generators/vault-seed/manifest.json"), "utf8"),
);
const tempRoots = [];

function makeTempRoot() {
	const root = mkdtempSync(path.join(os.tmpdir(), "vault-seed-release-consumer-"));
	tempRoots.push(root);
	return root;
}

after(() => {
	for (const root of tempRoots) {
		rmSync(root, { recursive: true, force: true });
	}
});

async function writeConsumerFixture(sourceDir) {
	await mkdir(path.join(sourceDir, "00 - Entrada"), { recursive: true });
	await mkdir(path.join(sourceDir, "docs"), { recursive: true });
	writeFileSync(path.join(sourceDir, "README.template.md"), "# Vault\n");
	writeFileSync(path.join(sourceDir, "CONTRIBUTING.template.md"), "# Contributing\n");
	writeFileSync(path.join(sourceDir, "AGENTS.template.md"), "# Agents\n");
	writeFileSync(path.join(sourceDir, "pnpm-lock.template.yaml"), "lockfileVersion: '9.0'\n");
	writeFileSync(path.join(sourceDir, "docs/dev.md"), "dev only\n");
	writeFileSync(
		path.join(sourceDir, "00 - Entrada/Bem-vindo ao seu vault.md"),
		"status: draft\n",
	);
	writeFileSync(
		path.join(sourceDir, "vault.config.json"),
		`${JSON.stringify({ kudos: ["vault-seed"], license: { name: "MIT" } }, null, 2)}\n`,
	);
	writeFileSync(
		path.join(sourceDir, "package.template.json"),
		`${JSON.stringify(
			{
				name: "generated-vault",
				private: true,
				repository: {
					type: "git",
					url: "https://github.com/{{REPO_NAME}}.git",
				},
				dependencies: {
					"@aretw0/dgk-astro-plugins": "workspace:^",
					"@refarm.dev/artifact-contract-v1": "^0.1.0",
					"@refarm.dev/channel-policy-v1": "^0.1.0",
					"@refarm.dev/ds": "^0.1.0",
					"@refarm.dev/process-handoff": "^0.1.0",
					"@refarm.dev/silo": "^0.1.0",
				},
				devDependencies: {
					"@refarm.dev/release-engine": "^0.1.0",
				},
			},
			null,
			2,
		)}\n`,
	);
}

function refarmPackageNames(packageJson) {
	const names = new Set();
	for (const sectionName of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
		"peerDependencies",
	]) {
		const section = packageJson[sectionName];
		if (!section || typeof section !== "object" || Array.isArray(section)) {
			continue;
		}
		for (const name of Object.keys(section)) {
			if (name.startsWith("@refarm.dev/")) {
				names.add(name);
			}
		}
	}
	return [...names].sort();
}

test("generated vault consumer dependencies are covered by vault-seed-ready release policy", async () => {
	const root = makeTempRoot();
	const sourceDir = path.join(root, "source");
	const outDir = path.join(root, "generated");
	await writeConsumerFixture(sourceDir);

	await generateVault({
		manifest,
		sourceDir,
		outDir,
		owner: "aretw0",
		repository: "aretw0/generated-vault",
	});

	const generatedPackage = JSON.parse(
		readFileSync(path.join(outDir, "package.json"), "utf8"),
	);
	const inventory = JSON.parse(
		readFileSync(path.join(outDir, "inventory.json"), "utf8"),
	);
	const consumerPackages = refarmPackageNames(generatedPackage);
	const check = buildReleaseCheckPlan({
		cwd: repoRoot,
		env: {
			REFARM_PACKAGE_MANAGER: "pnpm",
		},
		selectionId: "vault-seed-ready",
	});

	assert.equal(check.ok, true);
	assert.equal(
		generatedPackage.dependencies["@aretw0/dgk-astro-plugins"],
		"latest",
	);
	assert.deepEqual(inventory["package.json"], {
		source: "package.template.json",
		class: "transform",
		transforms: [
			"rename",
			"set-package-repository",
			"externalize-dgk-astro-plugins",
		],
	});
	assert.deepEqual(consumerPackages, [
		"@refarm.dev/artifact-contract-v1",
		"@refarm.dev/channel-policy-v1",
		"@refarm.dev/ds",
		"@refarm.dev/process-handoff",
		"@refarm.dev/release-engine",
		"@refarm.dev/silo",
	]);

	const planned = new Set(check.plan.orderedNames);
	const missing = consumerPackages.filter((name) => !planned.has(name));
	assert.deepEqual(missing, []);
	for (const packageName of consumerPackages) {
		const profile = check.plan.orderedPackages.find((pkg) => pkg.name === packageName)?.profile;
		assert.equal(
			profile?.tags?.includes("vault-seed-ready"),
			true,
			`${packageName} must stay tagged for vault-seed-ready`,
		);
		assert.ok(
			Array.isArray(profile?.mustPassChecks) && profile.mustPassChecks.length > 0,
			`${packageName} must declare release-policy checks`,
		);
	}
});
