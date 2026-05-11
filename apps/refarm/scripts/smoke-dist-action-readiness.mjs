#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const requiredDistEntries = [
	fileURLToPath(new URL("../dist/index.js", import.meta.url)),
	fileURLToPath(new URL("../../../packages/infra-cloudflare/dist/index.js", import.meta.url)),
	fileURLToPath(new URL("../../../packages/infra-turbo-cache/dist/index.js", import.meta.url)),
	// Worker source files must be copied to dist — wrangler bundles them at deploy time
	fileURLToPath(new URL("../../../packages/infra-cloudflare/dist/services/turbo-cache/worker/wrangler.toml", import.meta.url)),
	fileURLToPath(new URL("../../../packages/infra-cloudflare/dist/services/turbo-cache/worker/index.ts", import.meta.url)),
];
for (const entry of requiredDistEntries) {
	if (!existsSync(entry)) {
		throw new Error(`Missing dist entry — run \`npx turbo run build\` first:\n  ${entry}`);
	}
}
const statusWithActionsFixture =
	"apps/refarm/test/fixtures/status-with-actions.json";
const statusNoActionsFixture =
	"apps/refarm/test/fixtures/status-no-actions.json";

function runRefarm(args) {
	return execFileSync(process.execPath, [cliPath, ...args], {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			NO_COLOR: "1",
		},
	});
}

function assertRefarmFails(args, expected, label) {
	try {
		runRefarm(args);
	} catch (error) {
		const output = [error.stdout, error.stderr, error.message]
			.filter(Boolean)
			.join("\n");
		assertIncludes(output, expected, label);
		return;
	}
	throw new Error(
		`${label} should have failed with ${JSON.stringify(expected)}.`,
	);
}

function assertIncludes(value, expected, label) {
	if (!value.includes(expected)) {
		throw new Error(
			`${label} did not include ${JSON.stringify(expected)}.\n${value}`,
		);
	}
}

function assertBlockedNoActionsReadiness(envelope, label) {
	if (envelope.readiness?.status !== "blocked") {
		throw new Error(
			`Expected ${label} readiness.status=blocked, received ${envelope.readiness?.status}`,
		);
	}
	if (envelope.readiness?.label !== "Blocked: no host actions available") {
		throw new Error(
			`Expected ${label} no-actions readiness label, received ${envelope.readiness?.label}`,
		);
	}
	const rows = envelope.actionRows ?? envelope.availableActions;
	if (rows?.length !== 0) {
		throw new Error(
			`Expected ${label} action rows/actions=[], received ${JSON.stringify(rows)}`,
		);
	}
}

function assertHeadlessRenderer(envelope, label) {
	if (envelope.renderer !== "headless") {
		throw new Error(
			`Expected ${label} renderer=headless, received ${envelope.renderer}`,
		);
	}
}

function assertBlockedMissingSelectionReadiness(envelope, label) {
	if (envelope.readiness?.status !== "blocked") {
		throw new Error(
			`Expected ${label} readiness.status=blocked, received ${envelope.readiness?.status}`,
		);
	}
	if (
		envelope.readiness?.label !==
		'Blocked: host action "missing" is not available'
	) {
		throw new Error(
			`Expected ${label} missing-selection readiness label, received ${envelope.readiness?.label}`,
		);
	}
	if ("selectedAction" in envelope) {
		throw new Error(`${label} should not include selectedAction.`);
	}
	if ("selection" in envelope) {
		throw new Error(`${label} should not include selection metadata.`);
	}
	if ("actionRequest" in envelope) {
		throw new Error(`${label} should not include actionRequest.`);
	}
}

const webActions = runRefarm(["web", "--actions"]);
assertIncludes(webActions, "Available Web actions:", "web --actions");
assertIncludes(
	webActions,
	"[1] Open status report — open-status-report (refarm:status-open)",
	"web --actions",
);
assertIncludes(
	webActions,
	"[2] Inspect trust — inspect-trust (trust:inspect)",
	"web --actions",
);

const hostActionReadiness = JSON.parse(
	runRefarm(["actions", "--select", "2", "--json"]),
);
const artifactHostActionReadiness = JSON.parse(
	runRefarm([
		"actions",
		"--input",
		statusWithActionsFixture,
		"--select",
		"2",
		"--json",
	]),
);
const artifactNoActionsReadiness = JSON.parse(
	runRefarm(["actions", "--input", statusNoActionsFixture, "--json"]),
);
const webNoActionsReadiness = JSON.parse(
	runRefarm(["web", "--input", statusNoActionsFixture, "--actions", "--json"]),
);
const tuiNoActionsReadiness = JSON.parse(
	runRefarm(["tui", "--input", statusNoActionsFixture, "--actions", "--json"]),
);
const headlessNoActionsReadiness = JSON.parse(
	runRefarm([
		"headless",
		"--input",
		statusNoActionsFixture,
		"--action-request",
		"missing",
	]),
);
const artifactMissingHostActionReadiness = JSON.parse(
	runRefarm([
		"actions",
		"--input",
		statusWithActionsFixture,
		"--select",
		"missing",
		"--json",
	]),
);
const artifactMissingWebActionReadiness = JSON.parse(
	runRefarm([
		"web",
		"--input",
		statusWithActionsFixture,
		"--actions",
		"--select",
		"missing",
		"--json",
	]),
);
const artifactMissingHeadlessActionReadiness = JSON.parse(
	runRefarm([
		"headless",
		"--input",
		statusWithActionsFixture,
		"--action-request",
		"missing",
	]),
);
const artifactMissingTuiActionReadiness = JSON.parse(
	runRefarm([
		"tui",
		"--input",
		statusWithActionsFixture,
		"--actions",
		"--select",
		"missing",
		"--json",
	]),
);

if (hostActionReadiness.schemaVersion !== 1) {
	throw new Error(
		`Expected actions schemaVersion=1, received ${hostActionReadiness.schemaVersion}`,
	);
}
if (hostActionReadiness.reason !== "dry-run") {
	throw new Error(
		`Expected actions reason=dry-run, received ${hostActionReadiness.reason}`,
	);
}
if (hostActionReadiness.command !== "actions") {
	throw new Error(
		`Expected actions command=actions, received ${hostActionReadiness.command}`,
	);
}
if (hostActionReadiness.readiness?.status !== "ready") {
	throw new Error(
		`Expected actions readiness.status=ready, received ${hostActionReadiness.readiness?.status}`,
	);
}
if (hostActionReadiness.selection?.resolvedId !== "inspect-trust") {
	throw new Error(
		`Expected actions selection.resolvedId=inspect-trust, received ${hostActionReadiness.selection?.resolvedId}`,
	);
}
if (artifactHostActionReadiness.reason !== "dry-run") {
	throw new Error(
		`Expected artifact actions reason=dry-run, received ${artifactHostActionReadiness.reason}`,
	);
}
if (artifactHostActionReadiness.readiness?.status !== "ready") {
	throw new Error(
		`Expected artifact actions readiness.status=ready, received ${artifactHostActionReadiness.readiness?.status}`,
	);
}
if (artifactHostActionReadiness.selection?.resolvedId !== "inspect-trust") {
	throw new Error(
		`Expected artifact actions selection.resolvedId=inspect-trust, received ${artifactHostActionReadiness.selection?.resolvedId}`,
	);
}
assertBlockedNoActionsReadiness(artifactNoActionsReadiness, "actions");
assertBlockedNoActionsReadiness(webNoActionsReadiness, "web actions");
assertBlockedNoActionsReadiness(tuiNoActionsReadiness, "tui actions");
assertBlockedNoActionsReadiness(
	headlessNoActionsReadiness,
	"headless action request",
);
assertHeadlessRenderer(headlessNoActionsReadiness, "headless no-actions");
assertBlockedMissingSelectionReadiness(
	artifactMissingHostActionReadiness,
	"actions missing selection",
);
assertBlockedMissingSelectionReadiness(
	artifactMissingWebActionReadiness,
	"web actions missing selection",
);
assertBlockedMissingSelectionReadiness(
	artifactMissingHeadlessActionReadiness,
	"headless action request missing selection",
);
assertHeadlessRenderer(
	artifactMissingHeadlessActionReadiness,
	"headless missing selection",
);
assertBlockedMissingSelectionReadiness(
	artifactMissingTuiActionReadiness,
	"tui actions missing selection",
);

assertRefarmFails(
	["status", "--input", statusWithActionsFixture, "--action", "2"],
	"--action cannot be combined with --input",
	"status --action --input",
);

const statusAction = JSON.parse(runRefarm(["status", "--action", "2"]));

if (statusAction.schemaVersion !== 1) {
	throw new Error(
		`Expected schemaVersion=1, received ${statusAction.schemaVersion}`,
	);
}
if (statusAction.statusSchemaVersion !== 1) {
	throw new Error(
		`Expected statusSchemaVersion=1, received ${statusAction.statusSchemaVersion}`,
	);
}
if (statusAction.reason !== "executed") {
	throw new Error(`Expected reason=executed, received ${statusAction.reason}`);
}
if (statusAction.renderer !== "status") {
	throw new Error(
		`Expected renderer=status, received ${statusAction.renderer}`,
	);
}
if (statusAction.statusSource !== "live") {
	throw new Error(
		`Expected statusSource=live, received ${statusAction.statusSource}`,
	);
}
if (statusAction.handled !== true) {
	throw new Error(`Expected handled=true, received ${statusAction.handled}`);
}
if (statusAction.selection?.requested !== "2") {
	throw new Error(
		`Expected selection.requested=2, received ${statusAction.selection?.requested}`,
	);
}
if (statusAction.selection?.resolvedId !== "inspect-trust") {
	throw new Error(
		`Expected selection.resolvedId=inspect-trust, received ${statusAction.selection?.resolvedId}`,
	);
}
if (statusAction.actionRequest?.action?.intent !== "trust:inspect") {
	throw new Error(
		`Expected actionRequest.action.intent=trust:inspect, received ${statusAction.actionRequest?.action?.intent}`,
	);
}

const provisionDryRun = runRefarm([
	"provision",
	"cloudflare",
	"turbo-cache",
	"--dry-run",
]);
assertIncludes(
	provisionDryRun,
	"Cloudflare · Turborepo Remote Cache",
	"provision cloudflare turbo-cache --dry-run",
);
assertIncludes(
	provisionDryRun,
	"(dry-run — no resources will be created)",
	"provision cloudflare turbo-cache --dry-run",
);

console.log("dist action readiness smoke passed");
