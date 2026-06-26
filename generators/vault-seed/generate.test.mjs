import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

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
	await writeFile(path.join(sourceDir, "docs/x.md"), "dev docs\n");
	await writeFile(
		path.join(sourceDir, "00 - Entrada/note.md"),
		"status: draft\n",
	);
	await writeFile(path.join(sourceDir, ".dgk/state.json"), "{}\n");
	await writeFile(path.join(sourceDir, "payload.md"), "payload\n");
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
		],
		transforms: [
			{
				source: "00 - Entrada/note.md",
				target: "00 - Entrada/note.md",
				class: "transform",
				transforms: ["status-draft-to-published"],
				validation: "scripts/smoke_user_e2e.mjs",
			},
		],
		devOnly: ["docs", "README.template.md"],
		payloadGlobs: ["**"],
		derivedOrLocalState: [".dgk"],
	};

	const result = await generateVault({ manifest, sourceDir, outDir });

	assert.equal(readFileSync(path.join(outDir, "README.md"), "utf8"), "# Template\n");
	assert.equal(
		readFileSync(path.join(outDir, "00 - Entrada/note.md"), "utf8"),
		"status: draft\n",
	);
	assert.equal(readFileSync(path.join(outDir, "payload.md"), "utf8"), "payload\n");
	assert.equal(existsSync(path.join(outDir, "README.template.md")), false);
	assert.equal(existsSync(path.join(outDir, "docs/x.md")), false);
	assert.equal(existsSync(path.join(outDir, ".dgk/state.json")), false);

	assert.deepEqual(result.written.sort(), [
		"00 - Entrada/note.md",
		"README.md",
		"payload.md",
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
			source: "payload.md",
			target: "payload.md",
			class: "payload",
			transforms: [],
		},
	]);
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
