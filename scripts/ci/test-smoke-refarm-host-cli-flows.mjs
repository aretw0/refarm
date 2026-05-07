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
} from "./smoke-refarm-host-cli-flows.mjs";

test("lists focused CLI smoke profiles deterministically", () => {
	assert.equal(
		formatOnlyProfileList(),
		"action-seams, actions-readiness, status-action",
	);
	assert.deepEqual(createOnlyProfileListEnvelope(), {
		schemaVersion: 1,
		profiles: [
			{ profile: "action-seams" },
			{ profile: "actions-readiness" },
			{ profile: "status-action" },
		],
	});
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
