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
	resolveOnlyProfileNpmCommand,
	resolveOnlyProfileNpmScript,
	resolveOnlyProfileSkipBuildCommand,
	resolveOnlyProfileSkipBuildNpmCommand,
	resolveOnlyProfileSkipBuildNpmScript,
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
				npmScript: "refarm:host:smoke:cli:action-seams",
				npmCommand: "npm run refarm:host:smoke:cli:action-seams",
				command:
					"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only action-seams",
				skipBuildNpmScript:
					"refarm:host:smoke:cli:action-seams:skip-build",
				skipBuildNpmCommand:
					"npm run refarm:host:smoke:cli:action-seams:skip-build",
				skipBuildCommand:
					"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only action-seams --skip-build",
			},
			{
				profile: "actions-readiness",
				npmScript: "refarm:host:smoke:cli:actions-readiness",
				npmCommand: "npm run refarm:host:smoke:cli:actions-readiness",
				command:
					"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only actions-readiness",
				skipBuildNpmScript:
					"refarm:host:smoke:cli:actions-readiness:skip-build",
				skipBuildNpmCommand:
					"npm run refarm:host:smoke:cli:actions-readiness:skip-build",
				skipBuildCommand:
					"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only actions-readiness --skip-build",
			},
			{
				profile: "status-action",
				npmScript: "refarm:host:smoke:cli:status-action",
				npmCommand: "npm run refarm:host:smoke:cli:status-action",
				command:
					"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only status-action",
				skipBuildNpmScript:
					"refarm:host:smoke:cli:status-action:skip-build",
				skipBuildNpmCommand:
					"npm run refarm:host:smoke:cli:status-action:skip-build",
				skipBuildCommand:
					"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only status-action --skip-build",
			},
		],
	});
	assert.equal(
		resolveOnlyProfileNpmScript("action-seams"),
		"refarm:host:smoke:cli:action-seams",
	);
	assert.equal(
		resolveOnlyProfileNpmCommand("action-seams"),
		"npm run refarm:host:smoke:cli:action-seams",
	);
	assert.equal(
		resolveOnlyProfileCommand("action-seams"),
		"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only action-seams",
	);
	assert.equal(
		resolveOnlyProfileSkipBuildNpmScript("action-seams"),
		"refarm:host:smoke:cli:action-seams:skip-build",
	);
	assert.equal(
		resolveOnlyProfileSkipBuildNpmCommand("action-seams"),
		"npm run refarm:host:smoke:cli:action-seams:skip-build",
	);
	assert.equal(
		resolveOnlyProfileSkipBuildCommand("action-seams"),
		"node scripts/ci/smoke-refarm-host-cli-flows.mjs --only action-seams --skip-build",
	);
	assert.equal(resolveOnlyProfileNpmScript("missing"), undefined);
	assert.equal(resolveOnlyProfileNpmCommand("missing"), undefined);
	assert.equal(resolveOnlyProfileCommand("missing"), undefined);
	assert.equal(resolveOnlyProfileSkipBuildNpmScript("missing"), undefined);
	assert.equal(resolveOnlyProfileSkipBuildNpmCommand("missing"), undefined);
	assert.equal(resolveOnlyProfileSkipBuildCommand("missing"), undefined);
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
