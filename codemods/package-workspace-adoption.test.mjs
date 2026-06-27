import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	transformPackageWorkspaceAdoption,
	transformPackageWorkspaceAdoptionWithReport,
} from "./package-workspace-adoption.mjs";

const options = {
	name: "@aretw0/generated-vault",
	external: new Map([["@aretw0/dgk-astro-plugins", "latest"]]),
};

test("package workspace adoption fixture matches expected output", () => {
	const before = readFileSync(
		new URL("./fixtures/package-workspace-adoption.before.json", import.meta.url),
		"utf8",
	);
	const after = readFileSync(
		new URL("./fixtures/package-workspace-adoption.after.json", import.meta.url),
		"utf8",
	);

	assert.equal(transformPackageWorkspaceAdoption(before, options), after);
	assert.deepEqual(
		{
			...transformPackageWorkspaceAdoptionWithReport(before, options),
			json: undefined,
		},
		{
			json: undefined,
			changed: true,
			nameChanged: true,
			workspaceDependenciesRewritten: 1,
		},
	);
});

test("package workspace adoption is idempotent", () => {
	const after = readFileSync(
		new URL("./fixtures/package-workspace-adoption.after.json", import.meta.url),
		"utf8",
	);

	assert.equal(transformPackageWorkspaceAdoption(after, options), after);
});

test("package workspace adoption cli can emit a dry-run json report", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "refarm-package-codemod-"));
	const input = path.join(root, "package.json");
	writeFileSync(
		input,
		'{\n  "name": "digital-gardening-kit",\n  "dependencies": {\n    "@aretw0/dgk-astro-plugins": "workspace:^"\n  }\n}\n',
		"utf8",
	);

	const result = spawnSync(
		process.execPath,
		[
			new URL("./package-workspace-adoption.mjs", import.meta.url).pathname,
			"--input",
			input,
			"--name",
			"@aretw0/generated-vault",
			"--external",
			"@aretw0/dgk-astro-plugins=latest",
			"--json",
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
		},
	);

	assert.equal(result.status, 0);
	assert.deepEqual(JSON.parse(result.stdout), {
		input,
		changed: true,
		nameChanged: true,
		workspaceDependenciesRewritten: 1,
		written: false,
	});
	assert.equal(
		readFileSync(input, "utf8"),
		'{\n  "name": "digital-gardening-kit",\n  "dependencies": {\n    "@aretw0/dgk-astro-plugins": "workspace:^"\n  }\n}\n',
	);
});
