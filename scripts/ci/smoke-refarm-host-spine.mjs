#!/usr/bin/env node
import { runSubprocess } from "./subprocess-utils.mjs";

const LOGGER_PREFIX = "[refarm-host-smoke]";

function envFlag(name) {
	const value = process.env[name];
	return value === "1" || value === "true";
}

async function main() {
	const skipTypeCheck = envFlag("REFARM_HOST_SMOKE_SKIP_TYPECHECK");
	const env = process.env;

	console.log(`${LOGGER_PREFIX} starting unified host smoke checks...`);
	if (!skipTypeCheck) {
		console.log(`${LOGGER_PREFIX} running apps/refarm type-check...`);
		await runSubprocess(
			"npm",
			["--prefix", "apps/refarm", "run", "type-check"],
			{
				env,
			},
		);
	} else {
		console.log(
			`${LOGGER_PREFIX} skipping apps/refarm type-check (REFARM_HOST_SMOKE_SKIP_TYPECHECK=1)`,
		);
	}

	console.log(`${LOGGER_PREFIX} running focused host command smoke suite...`);
	await runSubprocess("npm", ["run", "refarm:host:smoke"], { env });

	if (!envFlag("REFARM_HOST_SMOKE_SKIP_CLI_FLOWS")) {
		console.log(`${LOGGER_PREFIX} running CLI flow smoke checks...`);
		await runSubprocess("npm", ["run", "refarm:host:smoke:cli"], { env });
	} else {
		console.log(
			`${LOGGER_PREFIX} skipping CLI flow smoke checks (REFARM_HOST_SMOKE_SKIP_CLI_FLOWS=1)`,
		);
	}

	console.log(`${LOGGER_PREFIX} passed`);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`${LOGGER_PREFIX} failed: ${message}`);
	process.exit(1);
});
