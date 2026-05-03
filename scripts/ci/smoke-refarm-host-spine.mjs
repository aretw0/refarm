#!/usr/bin/env node
import { runSubprocess } from "./subprocess-utils.mjs";

const LOGGER_PREFIX = "[refarm-host-smoke]";

function envFlag(name) {
	const value = process.env[name];
	return value === "1" || value === "true";
}

function hasArg(flag) {
	return process.argv.includes(flag);
}

async function main() {
	if (hasArg("--help") || hasArg("-h")) {
		console.log(`${LOGGER_PREFIX} usage:`);
		console.log(
			`  node scripts/ci/smoke-refarm-host-spine.mjs [--quick] [--skip-type-check] [--skip-cli-flows]`,
		);
		console.log(
			`  env: REFARM_HOST_SMOKE_SKIP_TYPECHECK=1 REFARM_HOST_SMOKE_SKIP_CLI_FLOWS=1`,
		);
		return;
	}

	const quick = hasArg("--quick");
	const skipTypeCheck =
		quick ||
		hasArg("--skip-type-check") ||
		envFlag("REFARM_HOST_SMOKE_SKIP_TYPECHECK");
	const skipCliFlows =
		quick ||
		hasArg("--skip-cli-flows") ||
		envFlag("REFARM_HOST_SMOKE_SKIP_CLI_FLOWS");
	const env = process.env;

	const profileLabel = quick
		? "quick"
		: skipTypeCheck && skipCliFlows
			? "custom(skip-type-check+skip-cli)"
			: skipTypeCheck
				? "dev(skip-type-check)"
				: skipCliFlows
					? "custom(skip-cli)"
					: "full";

	console.log(
		`${LOGGER_PREFIX} starting unified host smoke checks (profile=${profileLabel})...`,
	);
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

	if (!skipCliFlows) {
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
