#!/usr/bin/env node
import { packageFrozenInstallCommand } from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

function usage() {
	console.error("Usage: node scripts/ci/run-frozen-install.mjs [--plan]");
}

const args = process.argv.slice(2);
const plan = args.includes("--plan");
if (args.some((arg) => arg !== "--plan")) {
	usage();
	process.exit(1);
}

const command = packageFrozenInstallCommand();

if (plan) {
	console.log(command.display);
	process.exit(0);
}

console.log(`[frozen-install] ${command.display}`);
await runSubprocess(command.command, command.args, {
	cwd: process.cwd(),
	env: process.env,
});
