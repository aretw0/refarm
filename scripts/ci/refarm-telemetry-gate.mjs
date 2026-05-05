#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	ensureTaskSmokeTypeBuilds,
	parseJsonOutput,
	runSubprocess,
} from "./subprocess-utils.mjs";

const LOGGER_PREFIX = "[refarm-telemetry-gate]";
const DEFAULT_STRICT_CODES = [
	"saturation:queue",
	"saturation:inflight",
	"reliability:failure-rate",
];

function printUsage() {
	console.log(`${LOGGER_PREFIX} usage:`);
	console.log(
		"  node scripts/ci/refarm-telemetry-gate.mjs [--profile <name>] [--window-minutes <n>] [--strict-on <codes>] [--strict-all] [--out <path>] [--skip-build] [--timeout-ms <n>]",
	);
	console.log("\nOptions:");
	console.log(
		"  --profile <name>         conservative|balanced|throughput (default: balanced)",
	);
	console.log(
		"  --window-minutes <n>     Rolling window in minutes (default: 60)",
	);
	console.log(
		"  --strict-on <codes>      Comma-separated diagnostics to enforce (default: saturation+failure-rate)",
	);
	console.log(
		"  --strict-all             Enforce all diagnostics emitted by telemetry (disables strict-on filter)",
	);
	console.log(
		"  --out <path>             Write telemetry JSON artifact to file",
	);
	console.log("  --skip-build             Skip apps/refarm build step");
	console.log(
		"  --timeout-ms <n>         Sidecar readiness timeout in ms (default: 20000)",
	);
	console.log("  -h, --help               Show help");
}

function parseArgs(argv) {
	const options = {
		profile: "balanced",
		windowMinutes: "60",
		strictOn: DEFAULT_STRICT_CODES.join(","),
		strictAll: false,
		out: null,
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
			case "--strict-all":
				options.strictAll = true;
				break;
			case "--out": {
				const value = argv[index + 1];
				if (!value) throw new Error("Missing value for --out");
				options.out = value;
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

	if (options.strictAll && argv.includes("--strict-on")) {
		throw new Error("--strict-all cannot be combined with --strict-on");
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

async function readFarmhandLogTail() {
	try {
		const logPath = path.resolve(process.cwd(), ".refarm/farmhand.log");
		const content = await readFile(logPath, "utf8");
		return content.split("\n").filter(Boolean).slice(-80).join("\n");
	} catch {
		return "";
	}
}

async function waitForTelemetryReady(timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await isTelemetryReady()) return;
		await sleep(250);
	}
	const tail = await readFarmhandLogTail();
	throw new Error(
		`Timed out waiting for farmhand telemetry sidecar on :42001${tail ? `\n--- farmhand.log tail ---\n${tail}` : ""}`,
	);
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
	if (!options.strictAll && options.strictOn) {
		args.push("--strict-on", options.strictOn);
	}

	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, {
			env: { ...process.env, NODE_NO_WARNINGS: "1" },
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			const text = chunk.toString();
			stdout += text;
			process.stdout.write(text);
		});
		child.stderr.on("data", (chunk) => {
			const text = chunk.toString();
			stderr += text;
			process.stderr.write(text);
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (signal) {
				reject(new Error(`telemetry command terminated by signal ${signal}`));
				return;
			}
			resolve({ exitCode: code ?? 1, stdout, stderr });
		});
	});
}

async function maybeWriteArtifact(options, parsedJson, rawOutput, exitCode) {
	if (!options.out) return;
	const outputPath = path.resolve(process.cwd(), options.out);
	await mkdir(path.dirname(outputPath), { recursive: true });

	const payload = {
		createdAt: new Date().toISOString(),
		exitCode,
		profile: options.profile,
		windowMinutes: Number(options.windowMinutes),
		strictAll: options.strictAll,
		strictOn: options.strictOn,
		telemetry: parsedJson ?? null,
	};

	if (parsedJson) {
		await writeFile(
			outputPath,
			`${JSON.stringify(payload, null, 2)}\n`,
			"utf8",
		);
		return;
	}

	await writeFile(
		outputPath,
		`${JSON.stringify({ ...payload, rawOutput }, null, 2)}\n`,
		"utf8",
	);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	let startedFarmhand = false;

	try {
		if (!options.skipBuild) {
			await ensureTaskSmokeTypeBuilds(process.env, LOGGER_PREFIX, {
				skipWorkspaces: ["apps/refarm"],
			});
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

		const result = await runTelemetryCommand(options);
		let parsedTelemetry = null;
		try {
			parsedTelemetry = parseJsonOutput(result.stdout);
		} catch {
			// best-effort artifact capture still writes raw output
		}
		await maybeWriteArtifact(
			options,
			parsedTelemetry,
			result.stdout || result.stderr,
			result.exitCode,
		);

		if (result.exitCode === 0) {
			console.log(`${LOGGER_PREFIX} strict telemetry gate passed.`);
			return;
		}
		if (result.exitCode === 2) {
			console.error(`${LOGGER_PREFIX} strict telemetry gate failed.`);
			process.exit(2);
		}
		throw new Error(`telemetry command exited with code ${result.exitCode}`);
	} finally {
		if (startedFarmhand) {
			try {
				console.log(
					`${LOGGER_PREFIX} stopping farmhand daemon started by this gate...`,
				);
				await runSubprocess("npm", ["run", "farmhand:stop"], {
					env: process.env,
					captureOutput: false,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(
					`${LOGGER_PREFIX} warning: failed to stop farmhand cleanly: ${message}`,
				);
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
