#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { detectPackageManager } from "../packages/config/src/package-manager.js";

function releaseCheckCommand() {
	const packageManager = detectPackageManager();

	switch (packageManager) {
		case "pnpm":
			return { command: "pnpm", args: ["publish", "-r", "--dry-run"] };
		case "npm":
			return { command: "npm", args: ["publish", "--workspaces", "--dry-run"] };
		case "yarn":
			return {
				command: "yarn",
				args: ["workspaces", "foreach", "-A", "npm", "publish", "--dry-run"],
			};
		case "bun":
			return { command: "bun", args: ["publish", "--dry-run"] };
		default:
			throw new Error(`Unsupported package manager: ${packageManager}`);
	}
}

try {
	const { command, args } = releaseCheckCommand();
	execFileSync(command, args, { stdio: "inherit" });
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[release:check] ${message}`);
	process.exit(1);
}
