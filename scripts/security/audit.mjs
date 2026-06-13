#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { detectPackageManager } from "../../packages/config/src/package-manager.js";

function parseArgs(argv) {
	let auditLevel = null;
	let plan = false;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--plan") {
			plan = true;
			continue;
		}
		if (arg === "--level" || arg === "--audit-level") {
			auditLevel = argv[i + 1] ?? null;
			i += 1;
			continue;
		}
		if (arg.startsWith("--audit-level=")) {
			auditLevel = arg.slice("--audit-level=".length);
			continue;
		}
		if (arg.startsWith("--level=")) {
			auditLevel = arg.slice("--level=".length);
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}

	if (auditLevel && !["low", "moderate", "high", "critical"].includes(auditLevel)) {
		throw new Error(`Unsupported audit level: ${auditLevel}`);
	}

	return { auditLevel, plan };
}

function auditCommand({ auditLevel = null } = {}) {
	const packageManager = detectPackageManager();

	switch (packageManager) {
		case "pnpm":
		case "npm":
		case "bun":
			return {
				command: packageManager,
				args: ["audit", ...(auditLevel ? [`--audit-level=${auditLevel}`] : [])],
			};
		case "yarn":
			return {
				command: "yarn",
				args: ["npm", "audit", ...(auditLevel ? ["--severity", auditLevel] : [])],
			};
		default:
			throw new Error(`Unsupported package manager: ${packageManager}`);
	}
}

try {
	const options = parseArgs(process.argv.slice(2));
	const { command, args } = auditCommand(options);
	if (options.plan) {
		console.log([command, ...args].join(" "));
		process.exit(0);
	}
	execFileSync(command, args, { stdio: "inherit" });
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[security:audit] ${message}`);
	process.exit(1);
}
