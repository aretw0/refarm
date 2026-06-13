#!/usr/bin/env node
import { packageBinaryCommand } from "../../packages/config/src/package-manager.js";
import { runSubprocess } from "./subprocess-utils.mjs";

function usage() {
	console.error(
		"Usage: node scripts/ci/run-package-binary.mjs [--plan] <binary> [args...]",
	);
}

const args = process.argv.slice(2);
const plan = args.includes("--plan");
if (plan) {
	args.splice(args.indexOf("--plan"), 1);
}

const [binary, ...binaryArgs] = args;
if (!binary) {
	usage();
	process.exit(1);
}

const command = packageBinaryCommand(binary, binaryArgs);

if (plan) {
	console.log(command.display);
	process.exit(0);
}

console.log(`[package-binary] ${command.display}`);
await runSubprocess(command.command, command.args, {
	cwd: process.cwd(),
	env: process.env,
});
