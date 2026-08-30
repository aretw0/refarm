#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	buildFirstPublishPlan,
	firstPublishConfirmValue,
	parseFirstPublishArgs,
	isAlreadyPublished,
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
	// 24 since cc61342e: `@refarm.dev/vault-contract-v1` ENTERED the selection and this number
	// did not follow it — the ratchet's own rule, stated below, applied to a commit that then
	// skipped it. Measured 2026-08-28 on a CLEAN HEAD, which is how it was distinguished from the
	// change in flight the gate reported it against.
	//
	// 23 since 2026-08-16: `@refarm.dev/content-projection` REJOINED the `consumer-ready`
	// selection. ISS-113 held it out at 22 because nothing declared a dependency on it, and refused
	// to stamp `consumer-proven` to make a test green. The bar its three profile peers meet is a
	// consumer reaching the package from a surface that is NOT the contract test, and vault-seed's
	// records reference vault now structures its MD/MDX lane through `projectContentToRecords`.
	// The tag moved because the fact moved — not to make this number move.
	assert.equal(plan.packageCount, 25);
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

test("a package already on the registry at its exact version is skipped, not re-published", () => {
	const command = { packageName: "@refarm.dev/quality-contract-v1", version: "0.1.0" };
	assert.equal(isAlreadyPublished(command, () => true), true);
	assert.equal(isAlreadyPublished(command, () => false), false);
	assert.equal(isAlreadyPublished(command, () => undefined), false, "an unknown probe result never skips");
});
