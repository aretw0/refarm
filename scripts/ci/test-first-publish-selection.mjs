#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	buildFirstPublishPlan,
	firstPublishConfirmValue,
	parseFirstPublishArgs,
} from "../first-publish-selection.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("parses first-publish options", () => {
	assert.deepEqual(
		parseFirstPublishArgs([
			"--selection",
			"consumer-ready",
			"--package",
			"@refarm.dev/records-contract-v1",
			"--publish",
			"--confirm",
			"publish-consumer-ready-0.1.0",
			"--json",
			"--plan",
		]),
		{
			selectionId: "consumer-ready",
			packageNames: ["@refarm.dev/records-contract-v1"],
			publish: true,
			confirm: "publish-consumer-ready-0.1.0",
			json: true,
			planOnly: true,
		},
	);
});

test("plans vault-seed first-publish dry-run without version bumps", () => {
	const plan = buildFirstPublishPlan({
		cwd: ROOT,
		env: { REFARM_PACKAGE_MANAGER: "pnpm" },
		selectionId: "consumer-ready",
	});

	assert.equal(plan.mode, "dry-run");
		// 22 since ISS-113: `@refarm.dev/content-projection` left the `consumer-ready` selection
	// because NOTHING declares a dependency on it — the config was claiming "ready to hand to a
	// consumer" and "still a candidate" in one tag list. It carries `candidate-hold` now, which is
	// the third state: proposed, not proven, not blocking.
	assert.equal(plan.packageCount, 22);
	assert.equal(plan.requiredConfirmation, "publish-consumer-ready-0.1.0");
	assert.equal(plan.packages.every((pkg) => pkg.version === "0.1.0"), true);
	assert.equal(plan.commands.every((command) => command.display === "pnpm publish --dry-run --no-git-checks"), true);
});

test("requires explicit confirmation before publish mode", () => {
	assert.equal(firstPublishConfirmValue("ecosystem-ready"), "publish-ecosystem-ready-0.1.0");

	assert.throws(
		() =>
			buildFirstPublishPlan({
				cwd: ROOT,
				env: { REFARM_PACKAGE_MANAGER: "pnpm" },
				selectionId: "consumer-ready",
				publish: true,
				confirm: "",
			}),
		/publishing requires --confirm publish-consumer-ready-0\.1\.0/,
	);
});

test("plans publish commands only after exact confirmation", () => {
	const plan = buildFirstPublishPlan({
		cwd: ROOT,
		env: { REFARM_PACKAGE_MANAGER: "pnpm" },
		selectionId: "consumer-ready",
		publish: true,
		confirm: firstPublishConfirmValue("consumer-ready"),
	});

	assert.equal(plan.mode, "publish");
	assert.equal(plan.commands.every((command) => command.display === "pnpm publish --access public --provenance --no-git-checks"), true);
});
