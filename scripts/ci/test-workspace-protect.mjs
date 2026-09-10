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

// BOTH BRANCHES, each with its environment DECLARED, because this gate lives behind a container
// check and the previous single test asserted only the inside-a-container half. On any host it
// short-circuited to `skipped` and the assertion failed — on every machine that is not the
// devcontainer, invisibly, because no lane ran this suite (ISS-106).
test("workspace protection apply requires explicit wide-repair confirmation, inside a container", () => {
	const result = spawnSync(process.execPath, ["scripts/workspace-protect.mjs", "apply", "--json"], {
		cwd: process.cwd(),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			REFARM_WORKSPACE_HOST_WRITE_LOCK: "1",
			REFARM_CONTAINER_RUNTIME: "1",
		},
	});

	assert.equal(result.stderr, "");
	const output = JSON.parse(result.stdout);
	assert.equal(output.command, "workspace-protect");
	assert.equal(output.operation, "apply");

	// THE PROPERTY, not one spelling of it: `apply` never repairs without being told to. There
	// are two refusals in front of it and which one answers depends on where the repo is checked
	// out — outside /workspaces the run stops one step EARLIER, and that skip is correct rather
	// than a weaker result. Pinning `status === 1` pinned one of the two paths and made the test
	// a report of the machine it ran on.
	if (output.skipped === true) {
		assert.equal(result.status, 0, "a skip is not a failure");
		assert.match(output.message, /^skipped outside \/workspaces: /);
	} else {
		assert.equal(result.status, 1);
		assert.equal(output.ok, false);
		assert.equal(output.error, "wide-repair-confirmation-required");
	}
});

test("workspace protection apply does nothing at all outside a container", () => {
	const result = spawnSync(process.execPath, ["scripts/workspace-protect.mjs", "apply", "--json"], {
		cwd: process.cwd(),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			REFARM_WORKSPACE_HOST_WRITE_LOCK: "1",
			REFARM_CONTAINER_RUNTIME: "0",
		},
	});

	assert.equal(result.status, 0);
	const output = JSON.parse(result.stdout);
	assert.equal(output.skipped, true);
	assert.equal(output.message, "skipped outside container runtime");
});
