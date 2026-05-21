#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { detectPackageManager } from "../../packages/config/src/package-manager.js";

function auditCommand() {
	const packageManager = detectPackageManager();

	switch (packageManager) {
		case "pnpm":
		case "npm":
			return { command: packageManager, args: ["audit"] };
		case "yarn":
			return { command: "yarn", args: ["npm", "audit"] };
		case "bun":
			return { command: "bun", args: ["audit"] };
		default:
			throw new Error(`Unsupported package manager: ${packageManager}`);
	}
}

try {
	const { command, args } = auditCommand();
	execFileSync(command, args, { stdio: "inherit" });
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[security:audit] ${message}`);
	process.exit(1);
}
