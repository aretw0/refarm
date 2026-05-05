#!/usr/bin/env node
import { spawn } from "node:child_process";
import { runSubprocess } from "./subprocess-utils.mjs";

const LOGGER_PREFIX = "[refarm-telemetry-gate]";

function printUsage() {
	console.log(`${LOGGER_PREFIX} usage:`);
	console.log(
		"  node scripts/ci/refarm-telemetry-gate.mjs [--profile <name>] [--window-minutes <n>] [--strict-on <codes>] [--skip-build] [--timeout-ms <n>]",
	);
	console.log("\nOptions:");
	console.log("  --profile <name>         conservative|balanced|throughput (default: balanced)");
	console.log("  --window-minutes <n>     Rolling window in minutes (default: 60)");
	console.log("  --strict-on <codes>      Comma-separated diagnostics to enforce");
	console.log("  --skip-build             Skip apps/refarm build step");
	console.log("  --timeout-ms <n>         Sidecar readiness timeout in ms (default: 20000)");
	console.log("  -h, --help               Show help");
}

function parseArgs(argv) {
	const options = {
		profile: "balanced",
		windowMinutes: "60",
		strictOn: null,
		skipBuild: false,
		timeoutMs: 20_000,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "-h":
			case "--help":
				printUsage();
				process.exit(0);
			case "--profile": {
				const value = argv[index + 1];
				if (!value) throw new Error("Missing value for --profile");
				options.profile = value;
				index += 1;
				break;
			}
			case "--window-minutes": {
				const value = argv[index + 1];
				if (!value) throw new Error("Missing value for --window-minutes");
				options.windowMinutes = value;
				index += 1;
				break;
			}
			case "--strict-on": {
				const value = argv[index + 1];
				if (!value) throw new Error("Missing value for --strict-on");
				options.strictOn = value;
				index += 1;
				break;
			}
			case "--skip-build":
				options.skipBuild = true;
				break;
			case "--timeout-ms": {
				const value = Number(argv[index + 1]);
				if (!Number.isFinite(value) || value <= 0) {
					throw new Error("--timeout-ms must be a positive number");
				}
				options.timeoutMs = Math.floor(value);
				index += 1;
				break;
			}
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return options;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isTelemetryReady() {
	try {
		const response = await fetch("http://127.0.0.1:42001/telemetry", {
			signal: AbortSignal.timeout(1_500),
		});
		return response.ok;
	} catch {
		return false;
	}
}

async function waitForTelemetryReady(timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await isTelemetryReady()) return;
		await sleep(250);
	}
	throw new Error("Timed out waiting for farmhand telemetry sidecar on :42001");
}

async function runTelemetryCommand(options) {
	const args = [
		"--import",
		"./scripts/farmhand-node-register-loader.mjs",
		"apps/refarm/dist/index.js",
		"telemetry",
		"--json",
		"--strict",
		"--profile",
		options.profile,
		"--window-minutes",
		String(options.windowMinutes),
	];
	if (options.strictOn) {
		args.push("--strict-on", options.strictOn);
	}

	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, {
			env: { ...process.env, NODE_NO_WARNINGS: "1" },
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (signal) {
				reject(new Error(`telemetry command terminated by signal ${signal}`));
				return;
			}
			resolve(code ?? 1);
		});
	});
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	let startedFarmhand = false;

	try {
		if (!options.skipBuild) {
			console.log(`${LOGGER_PREFIX} building apps/refarm dist...`);
			await runSubprocess("npm", ["--prefix", "apps/refarm", "run", "build"], {
				env: process.env,
				captureOutput: false,
			});
		}

		const preReady = await isTelemetryReady();
		if (!preReady) {
			console.log(`${LOGGER_PREFIX} starting farmhand daemon...`);
			await runSubprocess("npm", ["run", "farmhand:daemon"], {
				env: process.env,
				captureOutput: false,
			});
			startedFarmhand = true;
			await waitForTelemetryReady(options.timeoutMs);
		} else {
			console.log(`${LOGGER_PREFIX} using existing farmhand daemon.`);
		}

		const exitCode = await runTelemetryCommand(options);
		if (exitCode === 0) {
			console.log(`${LOGGER_PREFIX} strict telemetry gate passed.`);
			return;
		}
		if (exitCode === 2) {
			console.error(`${LOGGER_PREFIX} strict telemetry gate failed.`);
			process.exit(2);
		}
		throw new Error(`telemetry command exited with code ${exitCode}`);
	} finally {
		if (startedFarmhand) {
			try {
				console.log(`${LOGGER_PREFIX} stopping farmhand daemon started by this gate...`);
				await runSubprocess("npm", ["run", "farmhand:stop"], {
					env: process.env,
					captureOutput: false,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`${LOGGER_PREFIX} warning: failed to stop farmhand cleanly: ${message}`);
			}
		}
	}
}

main().catch((error) => {
	console.error(
		`${LOGGER_PREFIX} ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(1);
});
