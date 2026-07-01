import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { generateVault } from "./generate.mjs";

const manifest = JSON.parse(
	readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);
const tempRoots = [];

function makeTempRoot() {
	const root = mkdtempSync(path.join(os.tmpdir(), "vault-seed-smoke-"));
	tempRoots.push(root);
	return root;
}

after(() => {
	for (const root of tempRoots) {
		rmSync(root, { recursive: true, force: true });
	}
});

function sourceDirOrSkip(t) {
	const sourceDir = process.env.VAULT_SEED_SOURCE_DIR;
	if (!sourceDir) {
		t.skip("set VAULT_SEED_SOURCE_DIR to smoke a generated vault");
		return null;
	}
	if (!existsSync(path.join(sourceDir, ".github/workflows/initialize.yml"))) {
		throw new Error(`VAULT_SEED_SOURCE_DIR is not a vault-seed checkout: ${sourceDir}`);
	}
	return sourceDir;
}

function existsIn(root, relativePath) {
	return existsSync(path.join(root, ...relativePath.split("/")));
}

test("generated vault from vault-seed source satisfies the template boundary", async (t) => {
	const sourceDir = sourceDirOrSkip(t);
	if (!sourceDir) return;

	const root = makeTempRoot();
	const outDir = path.join(root, "generated");
	await generateVault({
		manifest,
		sourceDir,
		outDir,
		owner: "aretw0",
		repository: "aretw0/generated-vault",
	});

	for (const entry of manifest.devOnly) {
		assert.equal(existsIn(outDir, entry), false, `dev-only leaked: ${entry}`);
	}
	for (const entry of manifest.derivedOrLocalState) {
		assert.equal(existsIn(outDir, entry), false, `local state leaked: ${entry}`);
	}
	for (const rename of manifest.renames) {
		assert.equal(
			existsIn(outDir, rename.target),
			true,
			`missing renamed target: ${rename.target}`,
		);
		assert.equal(
			existsIn(outDir, rename.source),
			false,
			`rename source leaked: ${rename.source}`,
		);
	}

	assert.equal(existsIn(outDir, "vendor/refarm.dev-ds-0.1.0.tgz"), false);
	assert.equal(
		existsIn(outDir, "scripts/refarm_ds_consumer_contract.test.mjs"),
		false,
	);

	const welcome = readFileSync(
		path.join(outDir, "00 - Entrada/Bem-vindo ao seu vault.md"),
		"utf8",
	);
	assert.match(welcome, /^status: published$/m);

	const config = JSON.parse(
		readFileSync(path.join(outDir, "vault.config.json"), "utf8"),
	);
	assert.equal("kudos" in config, false);
	assert.equal(config.license?.holder, "aretw0");
	assert.equal(config.license?.holderUrl, "https://github.com/aretw0");

	const inventory = JSON.parse(
		readFileSync(path.join(outDir, "inventory.json"), "utf8"),
	);
	assert.deepEqual(inventory["README.md"], {
		source: "README.template.md",
		class: "transform",
		transforms: ["rename"],
	});
	assert.deepEqual(inventory["vault.config.json"], {
		source: "vault.config.json",
		class: "transform",
		transforms: ["drop-kudos", "set-license-holder"],
		validation: "scripts/smoke_user_e2e.mjs",
	});
	assert.equal("inventory.json" in inventory, false);

	const packageJson = JSON.parse(
		readFileSync(path.join(outDir, "package.json"), "utf8"),
	);
	assert.equal(
		packageJson.repository?.url,
		"https://github.com/aretw0/generated-vault.git",
	);
	assert.equal(
		packageJson.dependencies?.["@aretw0/dgk-astro-plugins"],
		"latest",
	);
	assert.doesNotMatch(
		readFileSync(path.join(outDir, "package.json"), "utf8"),
		/\{\{REPO_NAME\}\}/,
	);
	assert.doesNotMatch(
		readFileSync(path.join(outDir, "package.json"), "utf8"),
		/"@aretw0\/dgk-astro-plugins":\s*"workspace:/,
	);
	assert.equal(packageJson.scripts?.changeset, undefined);
	assert.equal(packageJson.devDependencies?.["standard-version"], undefined);
});
