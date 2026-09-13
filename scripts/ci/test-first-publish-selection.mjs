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
	//
	// 28 since 2026-09-08 (ADR-080 amendment): `@refarm.dev/document-extraction-contract-v1`
	// ENTERED the selection.
	assert.equal(plan.packageCount, 28);
	assert.equal(plan.requiredConfirmation, "publish-consumer-ready-0.1.0");
	assert.equal(plan.packages.every((pkg) => pkg.version === "0.1.0"), true);
	assert.equal(plan.commands.every((command) => command.display === "pnpm publish --dry-run --no-git-checks"), true);
});

test("plans rcdc5 first-publish dry-run with an explicit eight-package boundary", () => {
	const plan = buildFirstPublishPlan({
		cwd: ROOT,
		env: { REFARM_PACKAGE_MANAGER: "pnpm" },
		selectionId: "rcdc5-ready",
	});

	assert.equal(plan.mode, "dry-run");
	assert.equal(plan.packageCount, 8);
	assert.equal(plan.requiredConfirmation, "publish-rcdc5-ready-0.1.0");
	assert.deepEqual(
		plan.packages.map((pkg) => pkg.name),
		[
			"@refarm.dev/source-contract-v1",
			"@refarm.dev/login-flow",
			"@refarm.dev/prompt-contract-v1",
			"@refarm.dev/diagnostic-bundle-v1",
			"@refarm.dev/source-web",
			"@refarm.dev/operation-result-v1",
			"@refarm.dev/browser-driver",
			"@refarm.dev/source-oslc",
		],
	);
	assert.equal(plan.packages.every((pkg) => pkg.version === "0.1.0"), true);
});

test("plans ecosystem-ready as one 34-package inaugural unit", () => {
	const plan = buildFirstPublishPlan({
		cwd: ROOT,
		env: { REFARM_PACKAGE_MANAGER: "pnpm" },
		selectionId: "ecosystem-ready",
	});

	assert.equal(plan.mode, "dry-run");
	assert.equal(plan.packageCount, 34);
	assert.equal(plan.requiredConfirmation, "publish-ecosystem-ready-0.1.0");
	assert.equal(plan.packages.every((pkg) => pkg.version === "0.1.0"), true);
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
