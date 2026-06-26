import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const manifest = JSON.parse(
	readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);

function candidateSourceDirs() {
	return [
		process.env.VAULT_SEED_SOURCE_DIR,
		path.resolve(repoRoot, "../vault-seed"),
		path.resolve(repoRoot, "../../vault-seed"),
	].filter(Boolean);
}

function findVaultSeedSourceDir() {
	return candidateSourceDirs().find((candidate) =>
		existsSync(path.join(candidate, ".github/workflows/initialize.yml")),
	);
}

function readInitializeYml(t) {
	const sourceDir = findVaultSeedSourceDir();
	if (!sourceDir) {
		t.skip(
			"set VAULT_SEED_SOURCE_DIR to a vault-seed checkout to cross-check initialize.yml",
		);
		return "";
	}
	return readFileSync(
		path.join(sourceDir, ".github/workflows/initialize.yml"),
		"utf8",
	);
}

test("manifest schema is well-formed", () => {
	assert.equal(manifest.version, 1);
	assert.equal(manifest.source, "vault-seed");
	assert.ok(Array.isArray(manifest.renames));
	assert.ok(Array.isArray(manifest.transforms));
	assert.ok(Array.isArray(manifest.devOnly));
	assert.deepEqual(manifest.payloadGlobs, ["**"]);
	assert.ok(Array.isArray(manifest.derivedOrLocalState));
});

test("every initialize.yml files_to_remove entry is classified dev-only", (t) => {
	const initYml = readInitializeYml(t);
	if (!initYml) return;

	const removeLine = /files_to_remove:\s*"([^"]+)"/.exec(initYml);
	assert.ok(removeLine, "files_to_remove not found");
	const removed = removeLine[1].split(/\s+/).filter(Boolean);
	for (const removedPath of removed) {
		assert.ok(
			manifest.devOnly.includes(removedPath),
			`missing dev-only classification: ${removedPath}`,
		);
	}
});

test("every rename in initialize.yml is a transform entry", (t) => {
	const initYml = readInitializeYml(t);
	if (!initYml) return;

	const renameLine = /files_to_rename:\s*"([^"]+)"/.exec(initYml);
	assert.ok(renameLine, "files_to_rename not found");
	const pairs = renameLine[1]
		.split(/\s+/)
		.filter(Boolean)
		.map((entry) => entry.split(":"));
	for (const [source, target] of pairs) {
		assert.ok(
			manifest.renames.some(
				(rename) => rename.source === source && rename.target === target,
			),
			`missing rename: ${source} -> ${target}`,
		);
	}
});

test("initialize.yml self-destruct workflow is classified dev-only", (t) => {
	const initYml = readInitializeYml(t);
	if (!initYml) return;

	const workflowLine = /workflow_filename:\s*"([^"]+)"/.exec(initYml);
	assert.ok(workflowLine, "workflow_filename not found");
	assert.ok(
		manifest.devOnly.includes(workflowLine[1]),
		`missing self-destruct workflow classification: ${workflowLine[1]}`,
	);
});

test("initialize.yml content transforms are represented", (t) => {
	const initYml = readInitializeYml(t);
	if (!initYml) return;

	assert.match(initYml, /status:\s+draft/);
	assert.ok(
		manifest.transforms.some(
			(entry) =>
				entry.source === "00 - Entrada/Bem-vindo ao seu vault.md" &&
				entry.transforms.includes("status-draft-to-published"),
		),
		"missing welcome-note publish transform",
	);
	assert.match(initYml, /delete cfg\.kudos/);
	assert.match(initYml, /cfg\.license\.holderUrl/);
	assert.ok(
		manifest.transforms.some(
			(entry) =>
				entry.source === "vault.config.json" &&
				entry.transforms.includes("drop-kudos") &&
				entry.transforms.includes("set-license-holder"),
		),
		"missing vault.config.json transforms",
	);
});
