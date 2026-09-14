import assert from "node:assert/strict";
import test from "node:test";
import { buildStageReleasePlan, parseStageReleaseArgs } from "./stage-release-packages.mjs";

function fakeGit(files) {
	return (_command, args) => {
		if (args[0] === "diff") return { status: 0, stdout: Object.keys(files.changed).join("\n"), stderr: "" };
		if (args[0] === "show") return { status: 0, stdout: JSON.stringify(files.revisions[args[1]]), stderr: "" };
		throw new Error(`unexpected command ${args.join(" ")}`);
	};
}

test("stage plan selects public version changes, including a new package", () => {
	const spawn = fakeGit({
		changed: { "packages/public/package.json": true, "packages/new/package.json": true, "packages/private/package.json": true, "packages/no-version/package.json": true },
		revisions: {
			"base:packages/public/package.json": { name: "@refarm.dev/public", version: "0.1.0", publishConfig: { access: "public" } },
			"head:packages/public/package.json": { name: "@refarm.dev/public", version: "0.1.1", publishConfig: { access: "public" } },
			"base:packages/new/package.json": null,
			"head:packages/new/package.json": { name: "@refarm.dev/new", version: "0.1.0", publishConfig: { access: "public" } },
			"base:packages/private/package.json": { name: "@refarm.dev/private", version: "0.1.0", private: true, publishConfig: { access: "public" } },
			"head:packages/private/package.json": { name: "@refarm.dev/private", version: "0.1.1", private: true, publishConfig: { access: "public" } },
			"base:packages/no-version/package.json": { name: "@refarm.dev/no-version", version: "0.1.0", publishConfig: { access: "public" } },
			"head:packages/no-version/package.json": { name: "@refarm.dev/no-version", version: "0.1.0", publishConfig: { access: "public" } },
		},
	});
	const plan = buildStageReleasePlan({ base: "base", head: "head", spawn });
	assert.deepEqual(plan.packages, [
		{ name: "@refarm.dev/public", version: "0.1.1", packageDir: "packages/public" },
		{ name: "@refarm.dev/new", version: "0.1.0", packageDir: "packages/new" },
	]);
});

test("stage CLI requires an explicit base revision", () => {
	assert.throws(() => parseStageReleaseArgs([]), /--base is required/);
	assert.deepEqual(parseStageReleaseArgs(["--base", "abc", "--head", "def", "--plan"]), {
		base: "abc", head: "def", plan: true, json: false,
	});
});
