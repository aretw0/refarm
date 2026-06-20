#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { packageWorkspacePublishDryRunCommand } from "../packages/config/src/package-manager.js";

function releaseCheckCommand() {
	return packageWorkspacePublishDryRunCommand();
}

try {
	const { command, args } = releaseCheckCommand();
	execFileSync(command, args, { stdio: "inherit" });
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[release:check] ${message}`);
	process.exit(1);
}
