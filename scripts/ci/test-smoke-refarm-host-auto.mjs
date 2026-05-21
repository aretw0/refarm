import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	createSmokeProfileDecisionEnvelope,
	createSmokeProfileListEnvelope,
	decideProfile,
	formatSmokeProfileList,
	formatUnknownSmokeProfileMessage,
	isFarmhandSidecarFile,
	isOpenApiProtocolFile,
	isRefarmCheckGateFile,
	isRefarmDriverTaskFile,
	isRefarmActionReadinessFile,
	isRefarmTreeFile,
	isSmokeProfile,
	listSmokeProfiles,
	normalizeChangedFiles,
	resolveProfileCommand,
	resolveProfileScript,
} from "./smoke-refarm-host-auto.mjs";

test("normalizes changed files before routing", () => {
	assert.deepEqual(
		normalizeChangedFiles([
			"docs/REFARM_CLI_DISTRO.md",
			".pi/todos/d777f597.md",
			"apps/refarm/src/commands/status.ts",
			"docs/REFARM_CLI_DISTRO.md",
		]),
		["apps/refarm/src/commands/status.ts", "docs/REFARM_CLI_DISTRO.md"],
	);
});

test("detects action-readiness files", () => {
	assert.equal(
		isRefarmActionReadinessFile(
			"apps/refarm/src/commands/action-affordances.ts",
		),
		true,
	);
	assert.equal(
		isRefarmActionReadinessFile(
			"apps/refarm/test/fixtures/status-no-actions.json",
		),
		true,
	);
	assert.equal(
		isRefarmActionReadinessFile("apps/refarm/src/commands/tree.ts"),
		false,
	);
});

test("detects tree timeline files", () => {
	assert.equal(isRefarmTreeFile("apps/refarm/src/commands/tree.ts"), true);
	assert.equal(
		isRefarmTreeFile("apps/farmhand/src/transports/sessions.test.ts"),
		true,
	);
	assert.equal(
		isRefarmTreeFile(
			"apps/farmhand/src/transports/effort-chat.integration.test.ts",
		),
		true,
	);
	assert.equal(
		isRefarmTreeFile("apps/refarm/src/commands/action-affordances.ts"),
		false,
	);
});

test("detects OpenAPI protocol files", () => {
	assert.equal(
		isOpenApiProtocolFile(
			"specs/protocols/http/farmhand-sidecar.openapi.v1.json",
		),
		true,
	);
	assert.equal(
		isOpenApiProtocolFile(
			"scripts/ci/check-openapi-specs.mjs",
		),
		true,
	);
	assert.equal(
		isOpenApiProtocolFile(
			"specs/ADRs/ADR-060-tractor-http-sidecar-protocol.md",
		),
		false,
	);
});

test("detects driver task files", () => {
	assert.equal(
		isRefarmDriverTaskFile("apps/farmhand/src/transports/tasks.ts"),
		true,
	);
	assert.equal(
		isRefarmDriverTaskFile("apps/refarm/test/commands/tasks.test.ts"),
		true,
	);
	assert.equal(
		isRefarmDriverTaskFile(
			"specs/protocols/http/farmhand-sidecar.openapi.v1.json",
		),
		true,
	);
	assert.equal(
		isRefarmDriverTaskFile("apps/refarm/src/commands/tree.ts"),
		false,
	);
});

test("detects farmhand sidecar files", () => {
	assert.equal(
		isFarmhandSidecarFile("apps/farmhand/src/index.ts"),
		true,
	);
	assert.equal(
		isFarmhandSidecarFile("apps/farmhand/src/transports/plugins.ts"),
		true,
	);
	assert.equal(
		isFarmhandSidecarFile(
			"specs/protocols/http/farmhand-sidecar.openapi.v1.json",
		),
		true,
	);
	assert.equal(
		isFarmhandSidecarFile("apps/refarm/src/commands/tree.ts"),
		false,
	);
});

test("lists smoke profiles from the canonical profile map", () => {
	assert.deepEqual(listSmokeProfiles(), [
		"skip",
		"actions-headless",
		"actions-renderers",
		"actions-test",
		"actions-type",
		"actions-dist",
		"action-seams",
		"actions",
		"tree-test",
		"tree-smoke",
		"tree-type",
		"tree-farmhand",
		"tree-dist",
		"tree",
		"openapi",
		"sidecar",
		"driver-tasks",
		"check",
		"quick",
		"dev",
		"ci",
	]);
	assert.equal(
		formatSmokeProfileList(),
		"skip, actions-headless, actions-renderers, actions-test, actions-type, actions-dist, action-seams, actions, tree-test, tree-smoke, tree-type, tree-farmhand, tree-dist, tree, openapi, sidecar, driver-tasks, check, quick, dev, ci",
	);
});

test("formats unknown profile errors with available profile hints", () => {
	assert.equal(
		formatUnknownSmokeProfileMessage("unknown"),
		`Unknown smoke profile: unknown. Available profiles: ${formatSmokeProfileList()}`,
	);
});

test("creates a smoke profile decision envelope", () => {
	assert.deepEqual(
		createSmokeProfileDecisionEnvelope({
			changeSet: {
				ahead: undefined,
				files: [],
				source: "explicit-profile",
			},
			changedFiles: [],
			command: "refarm:actions:headless:test",
			decision: {
				profile: "actions-headless",
				reason: "Explicit smoke profile requested: actions-headless.",
			},
		}),
		{
			schemaVersion: 1,
			profile: "actions-headless",
			reason: "Explicit smoke profile requested: actions-headless.",
			action: "run",
			script: "refarm:actions:headless:test",
			changeSet: {
				source: "explicit-profile",
				upstreamRef: undefined,
				ahead: undefined,
			},
			files: [],
		},
	);
});

test("creates a profile-to-script list envelope", () => {
	assert.deepEqual(createSmokeProfileListEnvelope(), {
		schemaVersion: 1,
		profiles: [
			{ profile: "skip", script: null },
			{ profile: "actions-headless", script: "refarm:actions:headless:test" },
			{ profile: "actions-renderers", script: "refarm:actions:renderers:test" },
			{ profile: "actions-test", script: "refarm:actions:test" },
			{ profile: "actions-type", script: "refarm:actions:type-check" },
			{ profile: "actions-dist", script: "refarm:actions:smoke-dist" },
			{
				profile: "action-seams",
				script: "refarm:host:smoke:cli:action-seams",
			},
			{ profile: "actions", script: "refarm:actions:verify" },
			{ profile: "tree-test", script: "refarm:tree:test" },
			{ profile: "tree-smoke", script: "refarm:tree:smoke" },
			{ profile: "tree-type", script: "refarm:tree:type-check" },
			{ profile: "tree-farmhand", script: "refarm:tree:farmhand:test" },
			{ profile: "tree-dist", script: "refarm:tree:smoke:cli" },
			{ profile: "tree", script: "refarm:tree:verify" },
			{ profile: "openapi", script: "openapi:check" },
			{ profile: "sidecar", script: "refarm:sidecar:verify" },
			{ profile: "driver-tasks", script: "refarm:driver:tasks:verify" },
			{ profile: "check", script: "refarm:check:verify" },
			{ profile: "quick", script: "refarm:host:smoke:quick" },
			{ profile: "dev", script: "refarm:host:smoke:dev" },
			{ profile: "ci", script: "refarm:host:smoke:ci" },
		],
	});
});

test("maps profiles to package scripts", () => {
	assert.equal(isSmokeProfile("skip"), true);
	assert.equal(isSmokeProfile("actions"), true);
	assert.equal(isSmokeProfile("action-seams"), true);
	assert.equal(isSmokeProfile("tree"), true);
	assert.equal(isSmokeProfile("actions-headless"), true);
	assert.equal(isSmokeProfile("tree-farmhand"), true);
	assert.equal(isSmokeProfile("unknown"), false);
	assert.equal(resolveProfileScript("skip"), null);
	assert.equal(
		resolveProfileScript("actions-headless"),
		"refarm:actions:headless:test",
	);
	assert.equal(
		resolveProfileScript("actions-renderers"),
		"refarm:actions:renderers:test",
	);
	assert.equal(resolveProfileScript("actions-test"), "refarm:actions:test");
	assert.equal(
		resolveProfileScript("actions-type"),
		"refarm:actions:type-check",
	);
	assert.equal(
		resolveProfileScript("actions-dist"),
		"refarm:actions:smoke-dist",
	);
	assert.equal(
		resolveProfileScript("action-seams"),
		"refarm:host:smoke:cli:action-seams",
	);
	assert.equal(resolveProfileScript("actions"), "refarm:actions:verify");
	assert.equal(resolveProfileScript("tree-test"), "refarm:tree:test");
	assert.equal(resolveProfileScript("tree-smoke"), "refarm:tree:smoke");
	assert.equal(resolveProfileScript("tree-type"), "refarm:tree:type-check");
	assert.equal(
		resolveProfileScript("tree-farmhand"),
		"refarm:tree:farmhand:test",
	);
	assert.equal(resolveProfileScript("tree-dist"), "refarm:tree:smoke:cli");
	assert.equal(resolveProfileScript("tree"), "refarm:tree:verify");
	assert.equal(resolveProfileScript("openapi"), "openapi:check");
	assert.equal(resolveProfileScript("sidecar"), "refarm:sidecar:verify");
	assert.equal(
		resolveProfileScript("driver-tasks"),
		"refarm:driver:tasks:verify",
	);
	assert.equal(resolveProfileScript("check"), "refarm:check:verify");
	assert.equal(resolveProfileScript("quick"), "refarm:host:smoke:quick");
	assert.equal(resolveProfileScript("dev"), "refarm:host:smoke:dev");
	assert.equal(resolveProfileScript("ci"), "refarm:host:smoke:ci");
	assert.equal(resolveProfileCommand("tree"), "pnpm run refarm:tree:verify");
});

test("maps profile command display through package manager override", () => {
	const previous = process.env.REFARM_PACKAGE_MANAGER;
	try {
		process.env.REFARM_PACKAGE_MANAGER = "bun";
		assert.equal(
			resolveProfileCommand("tree"),
			"bun run refarm:tree:verify",
		);
	} finally {
		if (previous === undefined) {
			delete process.env.REFARM_PACKAGE_MANAGER;
		} else {
			process.env.REFARM_PACKAGE_MANAGER = previous;
		}
	}
});

test("detects composite check gate files", () => {
	assert.equal(
		isRefarmCheckGateFile("apps/refarm/src/commands/check.ts"),
		true,
	);
	assert.equal(
		isRefarmCheckGateFile("apps/refarm/src/commands/health.ts"),
		true,
	);
	assert.equal(
		isRefarmCheckGateFile("packages/health/src/auditors/project.js"),
		true,
	);
	assert.equal(isRefarmCheckGateFile("refarm.config.json"), true);
	assert.equal(
		isRefarmCheckGateFile("apps/refarm/src/commands/status.ts"),
		false,
	);
});

test("routes action-readiness-only deltas to focused actions lane", () => {
	assert.equal(
		decideProfile([
			"apps/refarm/src/commands/action-affordances.ts",
			"apps/refarm/test/fixtures/status-no-actions.json",
			"docs/REFARM_ACTION_READINESS_COOKBOOK.md",
		]).profile,
		"actions",
	);
});

test("routes composite check gate deltas to focused check lane", () => {
	assert.equal(
		decideProfile([
			"apps/refarm/src/commands/check.ts",
			"apps/refarm/test/commands/check.test.ts",
			"docs/REFARM_CLI_DISTRO.md",
		]).profile,
		"check",
	);
	assert.equal(
		decideProfile([
			"apps/refarm/src/commands/health.ts",
			"apps/refarm/test/commands/health.test.ts",
		]).profile,
		"check",
	);
	assert.equal(
		decideProfile([
			"packages/health/src/auditors/generic.js",
			"packages/health/src/auditors/generic.test.js",
			"refarm.config.json",
		]).profile,
		"check",
	);
});

test("routes tree-only deltas to focused tree lane", () => {
	assert.equal(
		decideProfile([
			"apps/refarm/src/commands/tree.ts",
			"apps/refarm/test/commands/tree.test.ts",
			"apps/farmhand/src/transports/sessions.test.ts",
			"apps/farmhand/src/transports/effort-chat.integration.test.ts",
			"docs/REFARM_TREE_PRIMITIVE.md",
		]).profile,
		"tree",
	);
});

test("routes OpenAPI protocol deltas to focused OpenAPI lane", () => {
	assert.equal(
		decideProfile([
			"specs/protocols/http/farmhand-sidecar.openapi.v1.json",
			"specs/protocols/README.md",
		]).profile,
		"openapi",
	);
});

test("routes driver task deltas to focused driver task lane", () => {
	assert.equal(
		decideProfile([
			"apps/farmhand/src/transports/tasks.ts",
			"apps/farmhand/src/transports/tasks.test.ts",
			"apps/refarm/test/commands/tasks.test.ts",
			"specs/protocols/http/farmhand-sidecar.openapi.v1.json",
		]).profile,
		"driver-tasks",
	);
});

test("routes farmhand sidecar deltas to focused sidecar lane", () => {
	assert.equal(
		decideProfile([
			"apps/farmhand/src/transports/http.ts",
			"apps/farmhand/src/transports/plugins.ts",
			"apps/farmhand/src/index.ts",
			"specs/protocols/http/farmhand-sidecar.openapi.v1.json",
		]).profile,
		"sidecar",
	);
});

test("keeps smoke governance changes on ci lane", () => {
	assert.equal(
		decideProfile(["scripts/ci/smoke-refarm-host-auto.mjs"]).profile,
		"ci",
	);
	assert.equal(decideProfile(["package.json"]).profile, "ci");
});

test("skips empty, operational-note-only, or docs-only deltas", () => {
	assert.equal(decideProfile([]).profile, "skip");
	assert.equal(decideProfile([".pi/todos/d777f597.md"]).profile, "skip");
	assert.equal(decideProfile(["docs/REFARM_CLI_DISTRO.md"]).profile, "skip");
});

test("routes host source and CLI flow deltas to dev lane", () => {
	assert.equal(
		decideProfile(["apps/refarm/src/commands/status.ts"]).profile,
		"dev",
	);
	assert.equal(
		decideProfile(["scripts/ci/smoke-refarm-host-cli-flows.mjs"]).profile,
		"dev",
	);
});

test("routes mixed action and tree source deltas to dev lane", () => {
	assert.equal(
		decideProfile([
			"apps/refarm/src/commands/action-affordances.ts",
			"apps/refarm/src/commands/tree.ts",
		]).profile,
		"dev",
	);
});

test("routes shared execution-plan helper changes to dev lane", () => {
	assert.equal(
		decideProfile(["apps/refarm/src/commands/execution-plan.ts"]).profile,
		"dev",
	);
});

test("routes generic host tests to quick lane", () => {
	assert.equal(
		decideProfile(["apps/refarm/test/commands/program.test.ts"]).profile,
		"quick",
	);
});

test("explicit CLI profile bypasses diff detection", () => {
	const output = execFileSync(
		process.execPath,
		["scripts/ci/smoke-refarm-host-auto.mjs", "--profile", "tree"],
		{ encoding: "utf8" },
	);
	assert.match(output, /profile=tree files=0/);
	assert.match(output, /source=explicit-profile/);
	assert.match(output, /action=pnpm run refarm:tree:verify/);
});

test("explicit granular CLI profile maps to a narrow lane", () => {
	const output = execFileSync(
		process.execPath,
		[
			"scripts/ci/smoke-refarm-host-auto.mjs",
			"--profile",
			"actions-headless",
		],
		{ encoding: "utf8" },
	);
	assert.match(output, /profile=actions-headless files=0/);
	assert.match(output, /source=explicit-profile/);
	assert.match(output, /action=pnpm run refarm:actions:headless:test/);
});

test("explicit action-seams CLI profile maps to the combined action seam lane", () => {
	const output = execFileSync(
		process.execPath,
		["scripts/ci/smoke-refarm-host-auto.mjs", "--profile", "action-seams"],
		{ encoding: "utf8" },
	);
	assert.match(output, /profile=action-seams files=0/);
	assert.match(output, /source=explicit-profile/);
	assert.match(
		output,
		/action=pnpm run refarm:host:smoke:cli:action-seams/,
	);
});

test("explicit CLI profile can print a JSON preview envelope", () => {
	const output = execFileSync(
		process.execPath,
		[
			"scripts/ci/smoke-refarm-host-auto.mjs",
			"--profile",
			"actions-headless",
			"--json",
		],
		{ encoding: "utf8" },
	);
	assert.deepEqual(JSON.parse(output), {
		schemaVersion: 1,
		profile: "actions-headless",
		reason: "Explicit smoke profile requested: actions-headless.",
		action: "run",
		script: "refarm:actions:headless:test",
		changeSet: {
			source: "explicit-profile",
		},
		files: [],
	});
});

test("help output lists profiles from the canonical profile map", () => {
	const output = execFileSync(
		process.execPath,
		["scripts/ci/smoke-refarm-host-auto.mjs", "--help"],
		{ encoding: "utf8" },
	);
	assert.match(output, /profiles: skip, actions-headless/);
	assert.match(output, /tree-farmhand/);
	assert.match(output, /quick, dev, ci/);
	assert.match(output, /--list-profiles prints only/);
});

test("list-profiles prints only the canonical profile list", () => {
	const output = execFileSync(
		process.execPath,
		["scripts/ci/smoke-refarm-host-auto.mjs", "--list-profiles"],
		{ encoding: "utf8" },
	);
	assert.equal(output.trim(), formatSmokeProfileList());
});

test("list-profiles json prints profile-to-script mappings", () => {
	const output = execFileSync(
		process.execPath,
		["scripts/ci/smoke-refarm-host-auto.mjs", "--list-profiles", "--json"],
		{ encoding: "utf8" },
	);
	assert.deepEqual(JSON.parse(output), createSmokeProfileListEnvelope());
});

test("explicit CLI profile fails closed when unknown", () => {
	assert.throws(
		() =>
			execFileSync(
				process.execPath,
				["scripts/ci/smoke-refarm-host-auto.mjs", "--profile", "unknown"],
				{ encoding: "utf8", stdio: "pipe" },
			),
		(error) => {
			assert.equal(error.status, 1);
			assert.match(error.stderr, /Unknown smoke profile: unknown/);
			assert.match(error.stderr, /Available profiles: skip, actions-headless/);
			assert.match(error.stderr, /tree-farmhand/);
			return true;
		},
	);
});
