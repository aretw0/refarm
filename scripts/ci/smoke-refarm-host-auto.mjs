#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { packageScriptCommand } from "../../packages/config/src/package-manager.js";
import { runPackageScript, runSubprocess } from "./subprocess-utils.mjs";

const LOGGER_PREFIX = "[refarm-host-smoke:auto]";

const PROFILE_SCRIPT = {
	skip: null,
	"actions-headless": "refarm:actions:headless:test",
	"actions-renderers": "refarm:actions:renderers:test",
	"actions-test": "refarm:actions:test",
	"actions-type": "refarm:actions:type-check",
	"actions-dist": "refarm:actions:smoke-dist",
	"action-seams": "refarm:host:smoke:cli:action-seams",
	actions: "refarm:actions:verify",
	"tree-test": "refarm:tree:test",
	"tree-smoke": "refarm:tree:smoke",
	"tree-type": "refarm:tree:type-check",
	"tree-farmhand": "refarm:tree:farmhand:test",
	"tree-dist": "refarm:tree:smoke:cli",
	tree: "refarm:tree:verify",
	openapi: "openapi:check",
	"validation-pocs": "validation-pocs:test",
	"task-artifacts": "task-artifacts:check",
	"text-quality": "text-quality:verify",
	sidecar: "refarm:sidecar:verify",
	"driver-tasks": "refarm:driver:tasks:verify",
	"agent-e2e-mock": "refarm:agent:e2e:mock",
	install: "cli:install:verify",
	check: "refarm:check:verify",
	quick: "refarm:host:smoke:quick",
	dev: "refarm:host:smoke:dev",
	ci: "refarm:host:smoke:ci",
};

export function listSmokeProfiles() {
	return Object.keys(PROFILE_SCRIPT);
}

export function formatSmokeProfileList() {
	return listSmokeProfiles().join(", ");
}

export function createSmokeProfileListEnvelope() {
	return {
		schemaVersion: 1,
		profiles: listSmokeProfiles().map((profile) => ({
			profile,
			script: resolveProfileScript(profile),
		})),
	};
}

export function isSmokeProfile(profile) {
	return Object.hasOwn(PROFILE_SCRIPT, profile);
}

export function formatUnknownSmokeProfileMessage(profile) {
	return `Unknown smoke profile: ${profile}. Available profiles: ${formatSmokeProfileList()}`;
}

export function resolveProfileScript(profile) {
	return PROFILE_SCRIPT[profile];
}

export function resolveProfileCommand(profile) {
	const script = resolveProfileScript(profile);
	return script ? packageScriptCommand(script, { cwd: process.cwd() }).display : undefined;
}

export function createSmokeProfileDecisionEnvelope({
	changeSet,
	changedFiles,
	command,
	decision,
}) {
	return {
		schemaVersion: 1,
		profile: decision.profile,
		reason: decision.reason,
		action: command ? "run" : "skip",
		script: command,
		changeSet: {
			source: changeSet.source,
			upstreamRef: changeSet.upstreamRef,
			ahead: changeSet.ahead,
		},
		files: changedFiles,
	};
}

function hasArg(flag) {
	return process.argv.includes(flag);
}

function readArgValue(flag) {
	const index = process.argv.indexOf(flag);
	if (index < 0) return undefined;
	return process.argv[index + 1];
}

function parseChangedFileList(output) {
	return output
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

export function normalizeChangedFiles(files) {
	return Array.from(
		new Set(files.filter((file) => !isPiTodoFile(file))),
	).sort();
}

async function gitChangedFilesForRange(fromRef, toRef) {
	const range = `${fromRef}..${toRef}`;
	const { stdout } = await runSubprocess(
		"git",
		["diff", "--name-only", "--relative", range],
		{ env: process.env, captureOutput: true },
	);
	return normalizeChangedFiles(parseChangedFileList(stdout));
}

async function gitChangedFilesForWorkingTree() {
	const outputSets = await Promise.all([
		runSubprocess("git", ["diff", "--name-only", "--relative", "HEAD"], {
			env: process.env,
			captureOutput: true,
		}),
		runSubprocess("git", ["diff", "--name-only", "--cached", "--relative"], {
			env: process.env,
			captureOutput: true,
		}),
		runSubprocess("git", ["ls-files", "--others", "--exclude-standard"], {
			env: process.env,
			captureOutput: true,
		}),
	]);

	const files = new Set();
	for (const output of outputSets) {
		for (const file of parseChangedFileList(output.stdout)) {
			files.add(file);
		}
	}

	return normalizeChangedFiles(Array.from(files));
}

async function gitUpstreamRef() {
	try {
		const { stdout } = await runSubprocess(
			"git",
			["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
			{ env: process.env, captureOutput: true },
		);
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

async function gitAheadCount(upstreamRef) {
	try {
		const { stdout } = await runSubprocess(
			"git",
			["rev-list", "--count", `${upstreamRef}..HEAD`],
			{ env: process.env, captureOutput: true },
		);
		return Number.parseInt(stdout.trim(), 10) || 0;
	} catch {
		return 0;
	}
}

async function gitDefaultChangeSet() {
	const workingTreeFiles = await gitChangedFilesForWorkingTree();
	const upstreamRef = await gitUpstreamRef();
	if (!upstreamRef) {
		return {
			ahead: 0,
			files: workingTreeFiles,
			source: "working-tree",
		};
	}

	const ahead = await gitAheadCount(upstreamRef);
	if (ahead <= 0) {
		return {
			ahead,
			files: workingTreeFiles,
			source: "working-tree",
			upstreamRef,
		};
	}

	const committedFiles = await gitChangedFilesForRange(upstreamRef, "HEAD");
	return {
		ahead,
		files: normalizeChangedFiles([...committedFiles, ...workingTreeFiles]),
		source: "upstream-range+working-tree",
		upstreamRef,
	};
}

function isPiTodoFile(file) {
	return file.startsWith(".pi/todos/");
}

export function isDocsOnlyFile(file) {
	return (
		file.startsWith("docs/") ||
		file.startsWith("specs/") ||
		file.endsWith(".md") ||
		file.endsWith(".mdx")
	);
}

function isRefarmHostSourceFile(file) {
	return (
		file.startsWith("apps/refarm/src/") ||
		file === "apps/refarm/package.json" ||
		file === "apps/refarm/tsconfig.json" ||
		file === "apps/refarm/tsconfig.build.json"
	);
}

function isRefarmHostTestFile(file) {
	return file.startsWith("apps/refarm/test/");
}

function isHostSmokeGovernanceFile(file) {
	return (
		file === "scripts/ci/smoke-refarm-host-spine.mjs" ||
		file === "scripts/ci/smoke-refarm-host-auto.mjs" ||
		file === "package.json"
	);
}

function isHostSmokeCliFlowFile(file) {
	return file === "scripts/ci/smoke-refarm-host-cli-flows.mjs";
}

export function isCliInstallSurfaceFile(file) {
	return (
		file === ".devcontainer/devcontainer.json" ||
		file === ".devcontainer/farm" ||
		file === ".devcontainer/post-create.sh" ||
		file === ".devcontainer/post-start.sh" ||
		file === "scripts/install-refarm-cli.mjs" ||
		file === "scripts/pi-agent-install.mjs" ||
		file === "scripts/ci/check-node-substrate.mjs" ||
		file === "scripts/ci/test-check-node-substrate.mjs" ||
		file === "scripts/ci/test-devcontainer-contract.mjs" ||
		file === "scripts/ci/test-install-refarm-cli.mjs"
	);
}

export function isOpenApiProtocolFile(file) {
	return (
		file === "scripts/ci/check-openapi-specs.mjs" ||
		file === "specs/protocols/README.md" ||
		file.startsWith("specs/protocols/http/")
	);
}

export function isTaskArtifactManifestFile(file) {
	return (
		file === "scripts/ci/check-task-artifact-manifests.mjs" ||
		file === "scripts/ci/test-check-task-artifact-manifests-lib.mjs" ||
		(file.startsWith("validations/") &&
			(file.endsWith("/task-artifacts.json") ||
				file.includes("/fixtures/expected/")))
	);
}

export function isTextQualitySurfaceFile(file) {
	return (
		file === "scripts/ci/check-text-quality.mjs" ||
		file === "scripts/ci/text-quality-config-schema.mjs" ||
		file === "scripts/ci/test-text-quality-lib.mjs" ||
		file === "scripts/ci/text-quality-lib.mjs" ||
		file === "docs/POC_VALIDATION_PRESSURE.md" ||
		file === "docs/POC_PRIZE_READINESS.md" ||
		file === "docs/POC_WRITING_HANDOFF.md" ||
		file === "docs/TEXT_QUALITY_CONFIG.md" ||
		file === "docs/VAULT_SEED_CONVERGENCE.md"
	);
}

export function isValidationPocFile(file) {
	return (
		file === "scripts/ci/check-validation-poc-consumers.mjs" ||
		(!file.includes("/fixtures/expected/") &&
			(file.startsWith("validations/citizen-data-wallet-poc/") ||
				file.startsWith("validations/extension-sandbox-poc/") ||
				file.startsWith("validations/governed-note-box-poc/")))
	);
}

export function isRefarmDriverTaskFile(file) {
	return (
		file === "apps/farmhand/src/transports/tasks.ts" ||
		file === "apps/farmhand/src/transports/tasks.test.ts" ||
		file === "apps/refarm/src/commands/tasks.ts" ||
		file === "apps/refarm/test/commands/tasks.test.ts" ||
		file === "specs/protocols/http/farmhand-sidecar.openapi.v1.json"
	);
}

export function isFarmhandSidecarFile(file) {
	return (
		file === "apps/farmhand/src/index.ts" ||
		file === "apps/farmhand/src/transports/http.ts" ||
		file === "apps/farmhand/src/transports/http.test.ts" ||
		file === "apps/farmhand/src/transports/plugins.ts" ||
		file === "apps/farmhand/src/transports/plugins.test.ts" ||
		file === "apps/farmhand/src/transports/sessions.ts" ||
		file === "apps/farmhand/src/transports/sessions.test.ts" ||
		file === "apps/farmhand/src/transports/tasks.ts" ||
		file === "apps/farmhand/src/transports/tasks.test.ts" ||
		file === "specs/protocols/http/farmhand-sidecar.openapi.v1.json"
	);
}

export function isRefarmAgentRuntimeE2eFile(file) {
	return (
		file === "apps/refarm/src/commands/ask.ts" ||
		file === "apps/refarm/src/commands/pi-agent-effort.ts" ||
		file === "apps/refarm/src/commands/runtime-plugins.ts" ||
		file === "scripts/ci/smoke-refarm-agent-model-mock.mjs" ||
		file.startsWith("packages/pi-agent/") ||
		file.startsWith("packages/model-mock/") ||
		file.startsWith("packages/tractor/src/host/wasi_bridge/")
	);
}

export function isRefarmTreeFile(file) {
	return (
		file === "scripts/ci/smoke-refarm-tree-cli.mjs" ||
		file.startsWith("apps/refarm/src/commands/tree") ||
		file === "apps/refarm/test/commands/execution-plan.test.ts" ||
		file.startsWith("apps/refarm/test/commands/tree") ||
		file === "apps/farmhand/src/transports/sessions.ts" ||
		file === "apps/farmhand/src/transports/sessions.test.ts" ||
		file === "apps/farmhand/src/transports/effort-chat.integration.test.ts" ||
		file === "docs/REFARM_TREE_PRIMITIVE.md"
	);
}

export function isRefarmActionReadinessFile(file) {
	return (
		file === "apps/refarm/scripts/smoke-dist-action-readiness.mjs" ||
		file === "apps/refarm/src/commands/action-affordances.ts" ||
		file === "apps/refarm/src/commands/actions.ts" ||
		file === "apps/refarm/src/commands/headless-action.ts" ||
		file === "apps/refarm/src/commands/headless.ts" ||
		file === "apps/refarm/src/commands/tui-actions.ts" ||
		file === "apps/refarm/src/commands/tui.ts" ||
		file === "apps/refarm/src/commands/web-actions.ts" ||
		file === "apps/refarm/src/commands/web.ts" ||
		file.startsWith("apps/refarm/test/commands/action-") ||
		file === "apps/refarm/test/commands/actions.test.ts" ||
		file === "apps/refarm/test/commands/headless-action.test.ts" ||
		file === "apps/refarm/test/commands/headless.test.ts" ||
		file === "apps/refarm/test/commands/tui-actions.test.ts" ||
		file === "apps/refarm/test/commands/tui.test.ts" ||
		file === "apps/refarm/test/commands/web-actions.test.ts" ||
		file === "apps/refarm/test/commands/web.test.ts" ||
		file.startsWith("apps/refarm/test/fixtures/status-") ||
		file === "docs/REFARM_ACTION_READINESS_COOKBOOK.md" ||
		file === "docs/REFARM_STATUS_OUTPUT.md"
	);
}

export function isRefarmCheckGateFile(file) {
	return (
		file === "refarm.config.json" ||
		file === "packages/health/package.json" ||
		file === "packages/health/tsconfig.json" ||
		file === "packages/health/tsconfig.build.json" ||
		file.startsWith("packages/health/src/") ||
		file === "apps/refarm/src/commands/check.ts" ||
		file === "apps/refarm/src/commands/health.ts" ||
		file === "apps/refarm/src/commands/diagnostic-recommendations.ts" ||
		file === "apps/refarm/test/commands/check.test.ts" ||
		file === "apps/refarm/test/commands/health.test.ts" ||
		file === "docs/REFARM_CLI_DISTRO.md"
	);
}

export function decideProfile(inputFiles) {
	const files = normalizeChangedFiles(inputFiles);
	if (files.length === 0) {
		return {
			profile: "skip",
			reason:
				"No smoke-relevant file changes detected; skipping host smoke until there is a delta.",
		};
	}

	if (
		files.some((file) => isOpenApiProtocolFile(file)) &&
		files.every((file) => isOpenApiProtocolFile(file) || isDocsOnlyFile(file))
	) {
		return {
			profile: "openapi",
			reason:
				"Protocol contract delta; run focused OpenAPI validation.",
		};
	}

	if (
		files.some((file) => isValidationPocFile(file)) &&
		files.every((file) => isValidationPocFile(file) || isDocsOnlyFile(file))
	) {
		return {
			profile: "validation-pocs",
			reason:
				"Validation POC delta; run deterministic POC tests, consumer smoke, and task artifact manifest validation.",
		};
	}

	if (
		files.some((file) => isTaskArtifactManifestFile(file)) &&
		files.every(
			(file) => isTaskArtifactManifestFile(file) || isDocsOnlyFile(file),
		)
	) {
		return {
			profile: "task-artifacts",
			reason:
				"Task artifact manifest delta; run focused manifest integrity validation.",
		};
	}

	if (
		files.some((file) => isTextQualitySurfaceFile(file)) &&
		files.every((file) => isTextQualitySurfaceFile(file) || isDocsOnlyFile(file))
	) {
		return {
			profile: "text-quality",
			reason:
				"Text quality scorer or calibrated prose delta; run focused docs text-quality lane.",
		};
	}

	if (
		files.some((file) => isRefarmDriverTaskFile(file)) &&
		files.every(
			(file) =>
				isRefarmDriverTaskFile(file) ||
				isOpenApiProtocolFile(file) ||
				isDocsOnlyFile(file),
		)
	) {
		return {
			profile: "driver-tasks",
			reason:
				"Driver task-memory delta; run farmhand, CLI consumer, type-check, and OpenAPI contract lane.",
		};
	}

	if (
		files.some((file) => isFarmhandSidecarFile(file)) &&
		files.every(
			(file) =>
				isFarmhandSidecarFile(file) ||
				isOpenApiProtocolFile(file) ||
				isDocsOnlyFile(file),
		)
	) {
		return {
			profile: "sidecar",
			reason:
				"Farmhand sidecar delta; run focused sidecar handler, type-check, and OpenAPI contract lane.",
		};
	}

	if (files.every((file) => isDocsOnlyFile(file))) {
		return {
			profile: "skip",
			reason: "Docs-only delta; host smoke execution is not required.",
		};
	}

	if (
		files.some((file) => isCliInstallSurfaceFile(file)) &&
		files.every(
			(file) =>
				isCliInstallSurfaceFile(file) ||
				isDocsOnlyFile(file) ||
				file === "package.json",
		)
	) {
		return {
			profile: "install",
			reason:
				"CLI install/substrate delta; run installer dry-run tests, devcontainer contract tests, and node substrate output tests.",
		};
	}

	if (
		files.some((file) => isRefarmAgentRuntimeE2eFile(file)) &&
		files.every(
			(file) => isRefarmAgentRuntimeE2eFile(file) || isDocsOnlyFile(file),
		)
	) {
		return {
			profile: "agent-e2e-mock",
			reason:
				"Agent runtime/model bridge delta; run no-token Refarm agent e2e smoke.",
		};
	}

	if (
		files.some((file) => isRefarmCheckGateFile(file)) &&
		files.every((file) => isRefarmCheckGateFile(file) || isDocsOnlyFile(file))
	) {
		return {
			profile: "check",
			reason:
				"Composite check/health gate delta; run health tests, focused command tests, type-check, and built check gate.",
		};
	}

	if (
		files.every(
			(file) => isRefarmActionReadinessFile(file) || isDocsOnlyFile(file),
		)
	) {
		return {
			profile: "actions",
			reason:
				"Action-readiness delta; run focused action envelope tests, type-check, and dist smoke.",
		};
	}

	if (files.every((file) => isRefarmTreeFile(file) || isDocsOnlyFile(file))) {
		return {
			profile: "tree",
			reason:
				"Tree timeline delta; run focused tree contract, type-check, farmhand, and CLI smoke lane.",
		};
	}

	if (
		files.every((file) => isRefarmHostTestFile(file) || isDocsOnlyFile(file))
	) {
		return {
			profile: "quick",
			reason:
				"Refarm host tests/docs-only delta; run focused command smoke without type-check/CLI flow.",
		};
	}

	if (files.some((file) => isHostSmokeGovernanceFile(file))) {
		return {
			profile: "ci",
			reason: "Host smoke governance/wrapper changed; run full CI-parity lane.",
		};
	}

	if (
		files.some(
			(file) => isRefarmHostSourceFile(file) || isHostSmokeCliFlowFile(file),
		)
	) {
		return {
			profile: "dev",
			reason:
				"Host source or CLI flow changed; run dev lane (commands + CLI flows, skip duplicate type-check).",
		};
	}

	return {
		profile: "quick",
		reason: "No host-runtime critical delta; run cheapest host smoke lane.",
	};
}

async function main() {
	if (hasArg("--list-profiles")) {
		if (hasArg("--json")) {
			console.log(JSON.stringify(createSmokeProfileListEnvelope(), null, 2));
		} else {
			console.log(formatSmokeProfileList());
		}
		return;
	}

	if (hasArg("--help") || hasArg("-h")) {
		console.log(`${LOGGER_PREFIX} usage:`);
		console.log(
			"  node scripts/ci/smoke-refarm-host-auto.mjs [--execute] [--from <rev>] [--to <rev>] [--profile <profile>] [--list-profiles] [--json]",
		);
		console.log(`  profiles: ${formatSmokeProfileList()}`);
		console.log(
			"  default mode inspects upstream..HEAD when the branch is ahead, plus local working tree/staged/untracked files, and prints a recommendation.",
		);
		console.log(
			"  --profile bypasses diff detection and previews or executes the requested lane explicitly.",
		);
		console.log("  --json prints machine-readable plan/profile envelopes for preview modes.");
		console.log("  --list-profiles prints only the comma-separated profile list.");
		console.log("  --list-profiles --json prints profile-to-script mappings.");
		return;
	}

	const fromRef = readArgValue("--from");
	const toRef = readArgValue("--to") ?? "HEAD";
	const explicitProfile = readArgValue("--profile");
	const execute = hasArg("--execute");

	if (explicitProfile && !isSmokeProfile(explicitProfile)) {
		throw new Error(formatUnknownSmokeProfileMessage(explicitProfile));
	}

	let changeSet;
	if (explicitProfile) {
		changeSet = {
			ahead: undefined,
			files: [],
			source: "explicit-profile",
		};
	} else if (fromRef) {
		changeSet = {
			ahead: undefined,
			files: await gitChangedFilesForRange(fromRef, toRef),
			source: "explicit-range",
			upstreamRef: fromRef,
		};
	} else {
		changeSet = await gitDefaultChangeSet();
	}
	const changedFiles = changeSet.files;

	const decision = explicitProfile
		? {
				profile: explicitProfile,
				reason: `Explicit smoke profile requested: ${explicitProfile}.`,
			}
		: decideProfile(changedFiles);
	if (!isSmokeProfile(decision.profile)) {
		throw new Error(formatUnknownSmokeProfileMessage(decision.profile));
	}
	const command = resolveProfileScript(decision.profile);
	const planEnvelope = createSmokeProfileDecisionEnvelope({
		changeSet,
		changedFiles,
		command,
		decision,
	});

	if (hasArg("--json") && !execute) {
		console.log(JSON.stringify(planEnvelope, null, 2));
		return;
	}

	console.log(
		`${LOGGER_PREFIX} profile=${decision.profile} files=${changedFiles.length}`,
	);
	const upstreamLabel = changeSet.upstreamRef
		? ` upstream=${changeSet.upstreamRef}`
		: "";
	const aheadLabel =
		typeof changeSet.ahead === "number" ? ` ahead=${changeSet.ahead}` : "";
	console.log(
		`${LOGGER_PREFIX} source=${changeSet.source}${upstreamLabel}${aheadLabel}`,
	);
	console.log(`${LOGGER_PREFIX} reason=${decision.reason}`);
	if (changedFiles.length > 0) {
		const preview = changedFiles.slice(0, 12);
		console.log(`${LOGGER_PREFIX} files=${preview.join(", ")}`);
		if (changedFiles.length > preview.length) {
			console.log(
				`${LOGGER_PREFIX} files=... +${changedFiles.length - preview.length} more`,
			);
		}
	}

	if (!command) {
		console.log(`${LOGGER_PREFIX} action=skip`);
		return;
	}

	console.log(`${LOGGER_PREFIX} action=${resolveProfileCommand(decision.profile)}`);
	if (!execute) {
		return;
	}

	await runPackageScript(".", command, { env: process.env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${LOGGER_PREFIX} failed: ${message}`);
		process.exit(1);
	});
}
