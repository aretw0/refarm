#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function runRefarm(args) {
	return execFileSync(process.execPath, [cliPath, ...args], {
		cwd: repoRoot,
		encoding: "utf8",
		env: {
			...process.env,
			NO_COLOR: "1",
		},
	});
}

function assertIncludes(value, expected, label) {
	if (!value.includes(expected)) {
		throw new Error(
			`${label} did not include ${JSON.stringify(expected)}.\n${value}`,
		);
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

console.log("dist action readiness smoke passed");
