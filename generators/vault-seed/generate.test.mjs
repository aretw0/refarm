import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { execFileSync } from "node:child_process";

import { generateVault } from "./generate.mjs";

const tempRoots = [];

function makeTempRoot() {
	const root = mkdtempSync(path.join(os.tmpdir(), "vault-seed-gen-"));
	tempRoots.push(root);
	return root;
}

after(() => {
	for (const root of tempRoots) {
		rmSync(root, { recursive: true, force: true });
	}
});

async function writeFixture(sourceDir) {
	await mkdir(path.join(sourceDir, "docs"), { recursive: true });
	await mkdir(path.join(sourceDir, "00 - Entrada"), { recursive: true });
	await mkdir(path.join(sourceDir, ".dgk"), { recursive: true });
	await writeFile(path.join(sourceDir, "README.template.md"), "# Template\n");
	await writeFile(
		path.join(sourceDir, "package.template.json"),
		`${JSON.stringify({
			template: true,
			repository: {
				type: "git",
				url: "https://github.com/{{REPO_NAME}}.git",
			},
		})}\n`,
	);
	await writeFile(path.join(sourceDir, "package.json"), '{"dev":true}\n');
	await writeFile(path.join(sourceDir, "docs/x.md"), "dev docs\n");
	await writeFile(
		path.join(sourceDir, "00 - Entrada/note.md"),
		"status: draft\n",
	);
	await writeFile(path.join(sourceDir, ".dgk/state.json"), "{}\n");
	await writeFile(path.join(sourceDir, "payload.md"), "payload\n");
	await writeFile(
		path.join(sourceDir, "vault.config.json"),
		`${JSON.stringify(
			{
				kudos: ["vault-seed"],
				license: {
					name: "MIT",
				},
			},
			null,
			2,
		)}\n`,
	);
}

function readTree(root) {
	const entries = {};

	function visit(dir) {
		for (const name of readdirSync(dir).sort()) {
			const current = path.join(dir, name);
			const stat = statSync(current);
			if (stat.isDirectory()) {
				visit(current);
				continue;
			}
			if (!stat.isFile()) continue;
			entries[path.relative(root, current).split(path.sep).join("/")] =
				readFileSync(current, "utf8");
		}
	}

	visit(root);
	return entries;
}

test("generateVault copies payload, applies renames, skips dev-only paths, and records inventory", async () => {
	const root = makeTempRoot();
	const sourceDir = path.join(root, "source");
	const outDir = path.join(root, "out");
	await writeFixture(sourceDir);

	const manifest = {
		version: 1,
		source: "vault-seed",
		renames: [
			{
				source: "README.template.md",
				target: "README.md",
				class: "transform",
				transforms: ["rename"],
			},
			{
				source: "package.template.json",
				target: "package.json",
				class: "transform",
				transforms: ["rename", "set-package-repository"],
			},
		],
		transforms: [
			{
				source: "00 - Entrada/note.md",
				target: "00 - Entrada/note.md",
				class: "transform",
				transforms: ["status-draft-to-published"],
				validation: "scripts/smoke_user_e2e.mjs",
			},
			{
				source: "vault.config.json",
				target: "vault.config.json",
				class: "transform",
				transforms: ["drop-kudos", "set-license-holder"],
				validation: "scripts/smoke_user_e2e.mjs",
			},
		],
		devOnly: ["docs", "README.template.md", "package.template.json"],
		payloadGlobs: ["**"],
		derivedOrLocalState: [".dgk"],
	};

	const result = await generateVault({
		manifest,
		sourceDir,
		outDir,
		owner: "aretw0",
		repository: "aretw0/generated-vault",
	});

	assert.equal(readFileSync(path.join(outDir, "README.md"), "utf8"), "# Template\n");
	assert.equal(
		JSON.parse(readFileSync(path.join(outDir, "package.json"), "utf8"))
			.repository.url,
		"https://github.com/aretw0/generated-vault.git",
	);
	assert.equal(
		readFileSync(path.join(outDir, "00 - Entrada/note.md"), "utf8"),
		"status: published\n",
	);
	assert.deepEqual(
		JSON.parse(readFileSync(path.join(outDir, "vault.config.json"), "utf8")),
		{
			license: {
				name: "MIT",
				holder: "aretw0",
				holderUrl: "https://github.com/aretw0",
			},
		},
	);
	assert.equal(readFileSync(path.join(outDir, "payload.md"), "utf8"), "payload\n");
	assert.equal(existsSync(path.join(outDir, "README.template.md")), false);
	assert.equal(existsSync(path.join(outDir, "docs/x.md")), false);
	assert.equal(existsSync(path.join(outDir, ".dgk/state.json")), false);
	assert.deepEqual(
		JSON.parse(readFileSync(path.join(outDir, "inventory.json"), "utf8")),
		{
			"00 - Entrada/note.md": {
				source: "00 - Entrada/note.md",
				class: "transform",
				transforms: ["status-draft-to-published"],
				validation: "scripts/smoke_user_e2e.mjs",
			},
			"README.md": {
				source: "README.template.md",
				class: "transform",
				transforms: ["rename"],
			},
			"package.json": {
				source: "package.template.json",
				class: "transform",
				transforms: ["rename", "set-package-repository"],
			},
			"payload.md": {
				source: "payload.md",
				class: "payload",
				transforms: [],
			},
			"vault.config.json": {
				source: "vault.config.json",
				class: "transform",
				transforms: ["drop-kudos", "set-license-holder"],
				validation: "scripts/smoke_user_e2e.mjs",
			},
		},
	);

	assert.deepEqual(result.written.sort(), [
		"00 - Entrada/note.md",
		"README.md",
		"package.json",
		"payload.md",
		"vault.config.json",
	]);
	assert.ok(result.skipped.includes("docs"));
	assert.ok(result.skipped.includes(".dgk"));
	assert.deepEqual(result.inventory, [
		{
			source: "00 - Entrada/note.md",
			target: "00 - Entrada/note.md",
			class: "transform",
			transforms: ["status-draft-to-published"],
			validation: "scripts/smoke_user_e2e.mjs",
		},
		{
			source: "README.template.md",
			target: "README.md",
			class: "transform",
			transforms: ["rename"],
		},
		{
			source: "package.template.json",
			target: "package.json",
			class: "transform",
			transforms: ["rename", "set-package-repository"],
		},
		{
			source: "payload.md",
			target: "payload.md",
			class: "payload",
			transforms: [],
		},
		{
			source: "vault.config.json",
			target: "vault.config.json",
			class: "transform",
			transforms: ["drop-kudos", "set-license-holder"],
			validation: "scripts/smoke_user_e2e.mjs",
		},
	]);
});

test("generateVault content transforms are idempotent with a fixed owner", async () => {
	const root = makeTempRoot();
	const sourceDir = path.join(root, "source");
	const firstOut = path.join(root, "first");
	const secondSource = path.join(root, "second-source");
	const secondOut = path.join(root, "second");
	await writeFixture(sourceDir);

	const manifest = {
		version: 1,
		source: "vault-seed",
		renames: [],
		transforms: [
			{
				source: "00 - Entrada/note.md",
				target: "00 - Entrada/note.md",
				class: "transform",
				transforms: ["status-draft-to-published"],
			},
			{
				source: "vault.config.json",
				target: "vault.config.json",
				class: "transform",
				transforms: ["drop-kudos", "set-license-holder"],
			},
		],
		devOnly: ["docs"],
		payloadGlobs: ["**"],
		derivedOrLocalState: [".dgk"],
	};

	await generateVault({
		manifest,
		sourceDir,
		outDir: firstOut,
		owner: "aretw0",
		repository: "aretw0/generated-vault",
	});
	assert.equal(
		readFileSync(path.join(firstOut, "00 - Entrada/note.md"), "utf8"),
		"status: published\n",
	);
	assert.equal(
		JSON.parse(readFileSync(path.join(firstOut, "vault.config.json"), "utf8"))
			.license.holder,
		"aretw0",
	);
	await generateVault({
		manifest,
		sourceDir: firstOut,
		outDir: secondSource,
		owner: "aretw0",
		repository: "aretw0/generated-vault",
	});
	await generateVault({
		manifest,
		sourceDir: secondSource,
		outDir: secondOut,
		owner: "aretw0",
		repository: "aretw0/generated-vault",
	});

	assert.deepEqual(readTree(secondSource), readTree(secondOut));
});

test("generateVault treats inventory.json as generator output during re-generation", async () => {
	const root = makeTempRoot();
	const sourceDir = path.join(root, "source");
	const outDir = path.join(root, "out");
	await mkdir(sourceDir, { recursive: true });
	await writeFile(path.join(sourceDir, "payload.md"), "payload\n");
	await writeFile(path.join(sourceDir, "inventory.json"), '{"stale":true}\n');

	await generateVault({
		manifest: {
			version: 1,
			source: "vault-seed",
			renames: [],
			transforms: [],
			devOnly: [],
			payloadGlobs: ["**"],
			derivedOrLocalState: [],
		},
		sourceDir,
		outDir,
	});

	const inventory = JSON.parse(
		readFileSync(path.join(outDir, "inventory.json"), "utf8"),
	);
	assert.equal(existsSync(path.join(outDir, "payload.md")), true);
	assert.deepEqual(inventory, {
		"payload.md": {
			source: "payload.md",
			class: "payload",
			transforms: [],
		},
	});
	assert.equal("inventory.json" in inventory, false);
});

test("generateVault uses tracked files when sourceDir is a git checkout", async () => {
	const root = makeTempRoot();
	const sourceDir = path.join(root, "source");
	const outDir = path.join(root, "out");
	await mkdir(sourceDir, { recursive: true });
	await writeFile(path.join(sourceDir, "tracked.md"), "tracked\n");
	await writeFile(path.join(sourceDir, "untracked.md"), "untracked\n");
	execFileSync("git", ["init"], { cwd: sourceDir, stdio: "ignore" });
	execFileSync("git", ["add", "tracked.md"], { cwd: sourceDir, stdio: "ignore" });

	await generateVault({
		manifest: {
			version: 1,
			source: "vault-seed",
			renames: [],
			transforms: [],
			devOnly: [],
			payloadGlobs: ["**"],
			derivedOrLocalState: [],
		},
		sourceDir,
		outDir,
	});

	assert.equal(existsSync(path.join(outDir, "tracked.md")), true);
	assert.equal(existsSync(path.join(outDir, "untracked.md")), false);
});

test("generateVault rejects a missing source directory", async () => {
	const root = makeTempRoot();
	const outDir = path.join(root, "out");
	writeFileSync(path.join(root, "marker"), "");

	await assert.rejects(
		() =>
			generateVault({
				manifest: {
					version: 1,
					source: "vault-seed",
					renames: [],
					transforms: [],
					devOnly: [],
					payloadGlobs: ["**"],
					derivedOrLocalState: [],
				},
				sourceDir: path.join(root, "missing"),
				outDir,
			}),
		/sourceDir does not exist/,
	);
});
