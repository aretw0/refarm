#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
	buildFindPruneArgs,
	loadWorkspaceProtection,
} from "../workspace-protect.mjs";

test("workspace protection loads project-owned policy from refarm.config.json", () => {
	const policy = loadWorkspaceProtection(process.cwd(), {
		...process.env,
		REFARM_WORKSPACE_HOST_WRITE_LOCK: "1",
	});

	assert.equal(policy.enabled, true);
	assert.equal(policy.hostWriteLock, true);
	assert.equal(policy.markerPath.endsWith(".refarm/devcontainer-workspace.env"), true);
	assert.ok(policy.roots.includes(".git"));
	assert.ok(policy.roots.includes(".refarm"));
	assert.ok(policy.roots.includes("packages"));
	assert.ok(policy.pruneDirNames.includes("node_modules"));
});

test("workspace protection builds a find prune expression for mutable dependency trees", () => {
	assert.deepEqual(buildFindPruneArgs(["node_modules", ".cache"]), [
		"(",
		"-name",
		"node_modules",
		"-o",
		"-name",
		".cache",
		")",
		"-prune",
		"-o",
	]);
});

test("workspace protection check emits a JSON handoff", () => {
	const result = spawnSync(process.execPath, ["scripts/workspace-protect.mjs", "check", "--json"], {
		cwd: process.cwd(),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	assert.equal(result.status, 0);
	assert.equal(result.stderr, "");
	const output = JSON.parse(result.stdout);
	assert.equal(output.ok, true);
	assert.equal(output.command, "workspace-protect");
	assert.equal(output.operation, "check");
	assert.ok(Array.isArray(output.roots));
	assert.ok(output.roots.includes(".git"));
});
