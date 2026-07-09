#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 120_000;

const BENCHMARKS = [
	{
		id: "check-next-action",
		profile: "quick",
		command: "refarm",
		args: ["check", "--next-action", "--json"],
		description: "Composite readiness handoff used at the start of most lanes.",
	},
	{
		id: "dist-check-next-action",
		profile: "quick",
		command: process.execPath,
		args: ["apps/refarm/dist/index.js", "check", "--next-action", "--json"],
		description: "Direct dist entrypoint for comparing wrapper/startup overhead.",
	},
	{
		id: "dist-loader-check-next-action",
		profile: "quick",
		command: process.execPath,
		args: [
			"--import",
			pathToFileURL(resolve(ROOT, "scripts/farmhand-node-register-loader.mjs")).href,
			"apps/refarm/dist/index.js",
			"check",
			"--next-action",
			"--json",
		],
		description: "Direct dist entrypoint with the loader used by the public shim.",
	},
	{
		id: "tidy-imports-check",
		profile: "quick",
		command: "refarm",
		args: ["tidy", "imports", "--check", "--json"],
		description: "Public CLI import organization check for wrapper/startup comparison.",
	},
	{
		id: "toolbox-imports-check",
		profile: "quick",
		command: process.execPath,
		args: ["packages/toolbox/src/cli.mjs", "imports", "--check"],
		description: "Direct toolbox import check used inside agent finish lanes.",
	},
	{
		id: "agent-finish-quick",
		profile: "lane",
		command: "refarm",
		args: ["agent", "finish", "--profile", "quick", "--run", "--json"],
		description: "Small finish lane covering tidy + check without package validation.",
	},
	{
		id: "agent-finish-after-edit",
		profile: "lane",
		command: "refarm",
		args: ["agent", "finish", "--lane", "after-edit", "--run", "--json"],
		description: "Current affected after-edit lane, including package validation.",
	},
];

export function parseCliBenchArgs(argv = process.argv.slice(2)) {
	const options = {
		json: false,
		list: false,
		profile: "quick",
		iterations: 1,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		out: null,
		strict: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") {
			continue;
		} else if (arg === "--json") {
			options.json = true;
		} else if (arg === "--list") {
			options.list = true;
		} else if (arg === "--strict") {
			options.strict = true;
		} else if (arg === "--profile") {
			options.profile = requireValue(argv, index, arg);
			index += 1;
		} else if (arg.startsWith("--profile=")) {
			options.profile = arg.slice("--profile=".length);
		} else if (arg === "--iterations") {
			options.iterations = parsePositiveInteger(requireValue(argv, index, arg), arg);
			index += 1;
		} else if (arg.startsWith("--iterations=")) {
			options.iterations = parsePositiveInteger(arg.slice("--iterations=".length), "--iterations");
		} else if (arg === "--timeout-ms") {
			options.timeoutMs = parsePositiveInteger(requireValue(argv, index, arg), arg);
			index += 1;
		} else if (arg.startsWith("--timeout-ms=")) {
			options.timeoutMs = parsePositiveInteger(arg.slice("--timeout-ms=".length), "--timeout-ms");
		} else if (arg === "--out") {
			options.out = requireValue(argv, index, arg);
			index += 1;
		} else if (arg.startsWith("--out=")) {
			options.out = arg.slice("--out=".length);
		} else {
			throw new Error(`Unknown option "${arg}".`);
		}
	}
	if (!["quick", "lane", "all"].includes(options.profile)) {
		throw new Error('Invalid --profile. Use: quick, lane, all.');
	}
	return options;
}

export function selectCliBenchmarks(profile, benchmarks = BENCHMARKS) {
	if (profile === "all") return benchmarks;
	return benchmarks.filter((benchmark) => benchmark.profile === profile);
}

export function buildCliBenchSummary(results) {
	const total = results.length;
	const passed = results.filter((result) => result.ok).length;
	const failed = total - passed;
	const slowest = [...results].sort((a, b) => b.elapsedMs - a.elapsedMs)[0] ?? null;
	const fastest = [...results].sort((a, b) => a.elapsedMs - b.elapsedMs)[0] ?? null;
	return {
		total,
		passed,
		failed,
		slowest: slowest ? { id: slowest.id, elapsedMs: slowest.elapsedMs } : null,
		fastest: fastest ? { id: fastest.id, elapsedMs: fastest.elapsedMs } : null,
	};
}

export async function runCliBench(options = {}) {
	const resolved = {
		profile: options.profile ?? "quick",
		iterations: options.iterations ?? 1,
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	};
	const selected = selectCliBenchmarks(resolved.profile, options.benchmarks ?? BENCHMARKS);
	const results = [];
	for (const benchmark of selected) {
		for (let iteration = 1; iteration <= resolved.iterations; iteration += 1) {
			results.push(
				await runBenchmark(benchmark, {
					cwd: options.cwd ?? ROOT,
					iteration,
					timeoutMs: resolved.timeoutMs,
				}),
			);
		}
	}
	return {
		schemaVersion: SCHEMA_VERSION,
		command: "bench:cli",
		operation: "measure",
		ok: true,
		generatedAt: new Date().toISOString(),
		profile: resolved.profile,
		iterations: resolved.iterations,
		environment: {
			node: process.version,
			platform: process.platform,
			arch: process.arch,
			cwd: options.cwd ?? ROOT,
		},
		summary: buildCliBenchSummary(results),
		benchmarks: results,
	};
}

async function runBenchmark(benchmark, options) {
	const startedAt = process.hrtime.bigint();
	const result = await runProcess(benchmark.command, benchmark.args, {
		cwd: options.cwd,
		timeoutMs: options.timeoutMs,
	});
	const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
	const payload = parseCliBenchPayload(result.stdout);
	const payloadSummary = summarizeCliBenchPayload(payload, elapsedMs);
	return {
		id: benchmark.id,
		profile: benchmark.profile,
		description: benchmark.description,
		iteration: options.iteration,
		command: benchmark.command,
		args: benchmark.args,
		display: displayCommand(benchmark.command, benchmark.args),
		ok: result.exitCode === 0,
		exitCode: result.exitCode,
		elapsedMs,
		timedOut: result.timedOut,
		stdoutBytes: Buffer.byteLength(result.stdout),
		stderrBytes: Buffer.byteLength(result.stderr),
		...payloadSummary,
		stderrPreview: result.stderr.trim().slice(0, 500),
	};
}

function runProcess(command, args, options) {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: process.env,
		});
		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, options.timeoutMs);
		child.stdout.setEncoding("utf-8");
		child.stderr.setEncoding("utf-8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			resolve({
				exitCode: 1,
				stdout,
				stderr: stderr || error.message,
				timedOut,
			});
		});
		child.on("close", (code) => {
			clearTimeout(timeout);
			resolve({
				exitCode: code ?? 1,
				stdout,
				stderr,
				timedOut,
			});
		});
	});
}

export function parseCliBenchPayload(stdout) {
	try {
		return JSON.parse(stdout);
	} catch {
		// Some commands print human prelude lines before the JSON payload.
	}
	const objectStart = stdout.indexOf("{");
	const objectEnd = stdout.lastIndexOf("}");
	if (objectStart !== -1 && objectEnd > objectStart) {
		try {
			return JSON.parse(stdout.slice(objectStart, objectEnd + 1));
		} catch {
			// Fall back to compact line scanning below.
		}
	}
	const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
	for (const line of lines.reverse()) {
		try {
			return JSON.parse(line);
		} catch {
			// Keep scanning from the bottom for compact JSON payloads.
		}
	}
	return null;
}

export function summarizeCliBenchPayload(payload, elapsedMs = null) {
	const stepResults = Array.isArray(payload?.stepResults)
		? payload.stepResults
				.filter((step) => typeof step?.id === "string" && Number.isFinite(step?.elapsedMs))
				.map((step) => ({
					id: step.id,
					ok: typeof step.ok === "boolean" ? step.ok : null,
					elapsedMs: step.elapsedMs,
				}))
		: [];
	const slowestStep = [...stepResults].sort((a, b) => b.elapsedMs - a.elapsedMs)[0] ?? null;
	const stepElapsedMs = stepResults.reduce((total, step) => total + step.elapsedMs, 0);
	const overheadMs =
		stepResults.length > 0 && Number.isFinite(elapsedMs)
			? Math.max(0, elapsedMs - stepElapsedMs)
			: null;
	return {
		payloadOk: payload && typeof payload === "object" && "ok" in payload ? payload.ok : null,
		diagnostics: Array.isArray(payload?.diagnostics) ? payload.diagnostics : [],
		nextCommand: typeof payload?.nextCommand === "string" ? payload.nextCommand : null,
		stepResults,
		stepElapsedMs,
		overheadMs,
		slowestStep: slowestStep ? { id: slowestStep.id, elapsedMs: slowestStep.elapsedMs } : null,
	};
}

function displayCommand(command, args) {
	return [command, ...args].map((part) => (/\s/u.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function requireValue(argv, index, flag) {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
	return value;
}

function parsePositiveInteger(value, flag) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${flag} must be a positive integer.`);
	}
	return parsed;
}

function printHuman(report) {
	console.log(`CLI bench: ${report.profile} (${report.summary.total} samples)`);
	for (const result of report.benchmarks) {
		const status = result.ok ? "PASS" : "FAIL";
		const slowestStep = result.slowestStep ? ` slowestStep=${result.slowestStep.id}:${result.slowestStep.elapsedMs}ms` : "";
		const overhead = result.overheadMs ? ` overhead=${result.overheadMs}ms` : "";
		console.log(`${status} ${result.id} iteration=${result.iteration} elapsed=${result.elapsedMs}ms${slowestStep}${overhead}`);
	}
	if (report.summary.slowest) {
		console.log(`Slowest: ${report.summary.slowest.id} ${report.summary.slowest.elapsedMs}ms`);
	}
}

async function main() {
	try {
		const options = parseCliBenchArgs();
		if (options.list) {
			const benchmarks = selectCliBenchmarks(options.profile);
			const payload = {
				schemaVersion: SCHEMA_VERSION,
				command: "bench:cli",
				operation: "list",
				ok: true,
				profile: options.profile,
				benchmarks,
			};
			console.log(options.json ? JSON.stringify(payload, null, 2) : benchmarks.map((item) => item.id).join("\n"));
			return;
		}
		const report = await runCliBench(options);
		if (options.out) {
			const outPath = resolve(options.out);
			if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
			writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
		}
		if (options.json) {
			console.log(JSON.stringify(report, null, 2));
		} else {
			printHuman(report);
		}
		if (options.strict && report.summary.failed > 0) {
			process.exitCode = 1;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exitCode = 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await main();
}
