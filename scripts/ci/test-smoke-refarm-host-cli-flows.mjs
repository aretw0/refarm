import assert from "node:assert/strict";
import test from "node:test";
import {
	createOnlyProfileListEnvelope,
	formatHelp,
	formatOnlyProfileList,
	hasHelpArg,
	hasJsonArg,
	hasListOnlyProfilesArg,
	parseOnlyProfile,
	parseSkipBuild,
	resolveOnlyProfileCommand,
	resolveOnlyProfilePackageCommand,
	resolveOnlyProfilePackageScript,
	resolveOnlyProfileSkipBuildCommand,
	resolveOnlyProfileSkipBuildPackageCommand,
	resolveOnlyProfileSkipBuildPackageScript,
} from "./smoke-refarm-host-cli-flows.mjs";

test("lists focused CLI smoke profiles deterministically", () => {
	assert.equal(
		formatOnlyProfileList(),
		"action-seams, actions-readiness, status-action",
	);
	assert.deepEqual(createOnlyProfileListEnvelope(), {
		schemaVersion: 1,
		profiles: [
			{
				profile: "action-seams",
				packageScript: "refarm:host:smoke:cli:action-seams",
				packageCommand: "pnpm run refarm:host:smoke:cli:action-seams",
				command:
					"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only action-seams",
				skipBuildPackageScript:
					"refarm:host:smoke:cli:action-seams:skip-build",
				skipBuildPackageCommand:
					"pnpm run refarm:host:smoke:cli:action-seams:skip-build",
				skipBuildCommand:
					"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only action-seams --skip-build",
			},
			{
				profile: "actions-readiness",
				packageScript: "refarm:host:smoke:cli:actions-readiness",
				packageCommand: "pnpm run refarm:host:smoke:cli:actions-readiness",
				command:
					"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only actions-readiness",
				skipBuildPackageScript:
					"refarm:host:smoke:cli:actions-readiness:skip-build",
				skipBuildPackageCommand:
					"pnpm run refarm:host:smoke:cli:actions-readiness:skip-build",
				skipBuildCommand:
					"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only actions-readiness --skip-build",
			},
			{
				profile: "status-action",
				packageScript: "refarm:host:smoke:cli:status-action",
				packageCommand: "pnpm run refarm:host:smoke:cli:status-action",
				command:
					"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only status-action",
				skipBuildPackageScript:
					"refarm:host:smoke:cli:status-action:skip-build",
				skipBuildPackageCommand:
					"pnpm run refarm:host:smoke:cli:status-action:skip-build",
				skipBuildCommand:
					"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only status-action --skip-build",
			},
		],
	});
	assert.equal(
		resolveOnlyProfilePackageScript("action-seams"),
		"refarm:host:smoke:cli:action-seams",
	);
	assert.equal(
		resolveOnlyProfilePackageCommand("action-seams"),
		"pnpm run refarm:host:smoke:cli:action-seams",
	);
	assert.equal(
		resolveOnlyProfileCommand("action-seams"),
		"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only action-seams",
	);
	assert.equal(
		resolveOnlyProfileSkipBuildPackageScript("action-seams"),
		"refarm:host:smoke:cli:action-seams:skip-build",
	);
	assert.equal(
		resolveOnlyProfileSkipBuildPackageCommand("action-seams"),
		"pnpm run refarm:host:smoke:cli:action-seams:skip-build",
	);
	assert.equal(
		resolveOnlyProfileSkipBuildCommand("action-seams"),
		"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only action-seams --skip-build",
	);
	assert.equal(resolveOnlyProfilePackageScript("missing"), undefined);
	assert.equal(resolveOnlyProfilePackageCommand("missing"), undefined);
	assert.equal(resolveOnlyProfileCommand("missing"), undefined);
	assert.equal(resolveOnlyProfileSkipBuildPackageScript("missing"), undefined);
	assert.equal(resolveOnlyProfileSkipBuildPackageCommand("missing"), undefined);
	assert.equal(resolveOnlyProfileSkipBuildCommand("missing"), undefined);
});

test("lists focused CLI smoke package commands through package manager override", () => {
	const previous = process.env.REFARM_PACKAGE_MANAGER;
	try {
		process.env.REFARM_PACKAGE_MANAGER = "npm";
		assert.equal(
			resolveOnlyProfilePackageCommand("action-seams"),
			"npm run refarm:host:smoke:cli:action-seams",
		);
		assert.equal(
			resolveOnlyProfileSkipBuildPackageCommand("action-seams"),
			"npm run refarm:host:smoke:cli:action-seams:skip-build",
		);
	} finally {
		if (previous === undefined) {
			delete process.env.REFARM_PACKAGE_MANAGER;
		} else {
			process.env.REFARM_PACKAGE_MANAGER = previous;
		}
	}
});

test("parses focused CLI smoke flags", () => {
	assert.equal(parseOnlyProfile(["--only", "action-seams"]), "action-seams");
	assert.equal(parseOnlyProfile([]), undefined);
	assert.equal(parseSkipBuild(["--skip-build"]), true);
	assert.equal(parseSkipBuild([]), false);
	assert.equal(hasListOnlyProfilesArg(["--list-only-profiles"]), true);
	assert.equal(hasJsonArg(["--json"]), true);
	assert.equal(hasHelpArg(["--help"]), true);
	assert.equal(hasHelpArg(["-h"]), true);
});

test("focused CLI smoke profile parser fails closed", () => {
	assert.throws(
		() => parseOnlyProfile(["--only"]),
		/Missing value for --only\. Available profiles: action-seams, actions-readiness, status-action\./,
	);
	assert.throws(
		() => parseOnlyProfile(["--only", "nope"]),
		/Unknown --only profile "nope"\. Available profiles: action-seams, actions-readiness, status-action\./,
	);
});

test("help output documents focused CLI smoke options", () => {
	const help = formatHelp();
	assert.match(help, /\[refarm-host-cli-smoke\] usage:/);
	assert.match(help, /--only <profile>/);
	assert.match(help, /--skip-build/);
	assert.match(help, /--list-only-profiles/);
	assert.match(help, /focused profiles: action-seams, actions-readiness, status-action/);
});
