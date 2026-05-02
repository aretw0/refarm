#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	prepareTaskSmokeTypeBuilds,
	runSubprocess,
} from "./subprocess-utils.mjs";

const TERMINAL_STATUSES = new Set(["done", "failed", "cancelled"]);

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(input) {
	return input.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function parseJsonOutput(output) {
	const cleaned = stripAnsi(output).trim();
	if (!cleaned) {
		throw new Error("Command produced empty JSON output");
	}

	try {
		return JSON.parse(cleaned);
	} catch {
		const start = cleaned.indexOf("{");
		const end = cleaned.lastIndexOf("}");
		if (start >= 0 && end > start) {
			return JSON.parse(cleaned.slice(start, end + 1));
		}
		throw new Error(`Unable to parse JSON output:\n${cleaned}`);
	}
}

async function stopProcess(child) {
	if (!child || child.exitCode !== null) return;
	child.kill("SIGTERM");
	const startedAt = Date.now();
	while (child.exitCode === null && Date.now() - startedAt < 5_000) {
		await sleep(100);
	}
	if (child.exitCode === null) {
		child.kill("SIGKILL");
	}
}

async function waitForSidecarReady(url, farmhand, timeoutMs = 20_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (farmhand.exitCode !== null) {
			throw new Error(`Farmhand exited early with code ${farmhand.exitCode}`);
		}
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// sidecar still booting
		}
		await sleep(300);
	}
	throw new Error(`Timed out waiting for Farmhand sidecar at ${url}`);
}

function extractEffortId(output) {
	const cleaned = stripAnsi(output);
	const match = cleaned.match(/Effort dispatched:\s*([0-9a-fA-F-]{36})/);
	if (!match) {
		throw new Error(`Could not parse effort id from output:\n${cleaned}`);
	}
	return match[1];
}

async function queryStatus({ env, effortId }) {
	const { stdout } = await runSubprocess(
		process.execPath,
		[
			"scripts/ci/task-smoke-cli.mjs",
			"status",
			effortId,
			"--transport",
			"http",
			"--json",
		],
		{ env, captureOutput: true },
	);
	return parseJsonOutput(stdout);
}

async function waitForTerminalStatus({ env, effortId, timeoutMs = 40_000 }) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		last = await queryStatus({ env, effortId });
		if (TERMINAL_STATUSES.has(last.status)) {
			return last;
		}
		await sleep(500);
	}

	throw new Error(
		`Timed out waiting terminal status for ${effortId}. Last payload: ${JSON.stringify(last)}`,
	);
}

async function waitForRetryTerminalStatus({
	env,
	effortId,
	previousStamp,
	timeoutMs = 40_000,
}) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		last = await queryStatus({ env, effortId });
		const nextStamp =
			last?.result?.lastUpdatedAt ?? last?.result?.completedAt ?? null;
		if (
			nextStamp &&
			nextStamp !== previousStamp &&
			TERMINAL_STATUSES.has(last.status)
		) {
			return last;
		}
		await sleep(500);
	}

	throw new Error(
		`Timed out waiting retry terminal status for ${effortId} (previousStamp=${previousStamp}). Last payload: ${JSON.stringify(last)}`,
	);
}

async function main() {
	const keepArtifacts =
		process.env.REFARM_TASK_SMOKE_KEEP_ARTIFACTS === "1" ||
		process.env.REFARM_TASK_SMOKE_KEEP_ARTIFACTS === "true";

	const tempHome = await mkdtemp(path.join(tmpdir(), "refarm-task-smoke-"));
	const env = {
		...process.env,
		HOME: tempHome,
		USERPROFILE: tempHome,
	};

	let farmhand = null;
	let farmhandLogs = "";

	try {
		await prepareTaskSmokeTypeBuilds(env, "[task-smoke]");

		console.log(
			"[task-smoke] starting smoke daemon (FileTransport + HttpSidecar)...",
		);
		farmhand = spawn(process.execPath, ["scripts/ci/task-smoke-daemon.mjs"], {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		farmhand.stdout.on("data", (chunk) => {
			farmhandLogs += chunk.toString();
		});
		farmhand.stderr.on("data", (chunk) => {
			farmhandLogs += chunk.toString();
		});

		await waitForSidecarReady(
			"http://127.0.0.1:42001/efforts/summary",
			farmhand,
		);
		console.log("[task-smoke] farmhand sidecar is ready");

		const runOutput = await runSubprocess(
			process.execPath,
			[
				"scripts/ci/task-smoke-cli.mjs",
				"run",
				"smoke.missing",
				"execute",
				"--direction",
				"CI smoke loop",
				"--transport",
				"http",
			],
			{ env, captureOutput: true },
		);

		const effortId = extractEffortId(
			`${runOutput.stdout}\n${runOutput.stderr}`,
		);
		console.log(`[task-smoke] effort dispatched: ${effortId}`);

		const firstTerminal = await waitForTerminalStatus({ env, effortId });
		if (!TERMINAL_STATUSES.has(firstTerminal.status)) {
			throw new Error(
				`Unexpected non-terminal status: ${firstTerminal.status}`,
			);
		}

		const firstUpdatedStamp =
			firstTerminal?.result?.lastUpdatedAt ??
			firstTerminal?.result?.completedAt ??
			null;
		if (!firstUpdatedStamp) {
			throw new Error(
				"First terminal result missing lastUpdatedAt/completedAt",
			);
		}

		const listOutput = await runSubprocess(
			process.execPath,
			[
				"scripts/ci/task-smoke-cli.mjs",
				"list",
				"--transport",
				"http",
				"--json",
			],
			{ env, captureOutput: true },
		);
		const listPayload = parseJsonOutput(listOutput.stdout);
		const knownEfforts = Array.isArray(listPayload.efforts)
			? listPayload.efforts
			: [];
		if (!knownEfforts.some((entry) => entry?.effortId === effortId)) {
			throw new Error(`Effort ${effortId} not present in task list output`);
		}

		const logsOutput = await runSubprocess(
			process.execPath,
			[
				"scripts/ci/task-smoke-cli.mjs",
				"logs",
				effortId,
				"--transport",
				"http",
				"--json",
			],
			{ env, captureOutput: true },
		);
		const logsPayload = parseJsonOutput(logsOutput.stdout);
		if (!Array.isArray(logsPayload.logs) || logsPayload.logs.length === 0) {
			throw new Error("Expected at least one log entry for smoke effort");
		}
		if (
			!logsPayload.logs.some((entry) => entry?.event === "processing_finished")
		) {
			throw new Error("Expected processing_finished event in pre-retry logs");
		}

		await runSubprocess(
			process.execPath,
			[
				"scripts/ci/task-smoke-cli.mjs",
				"retry",
				effortId,
				"--transport",
				"http",
			],
			{ env, captureOutput: true },
		);

		const retryTerminal = await waitForRetryTerminalStatus({
			env,
			effortId,
			previousStamp: firstUpdatedStamp,
		});
		const retryAttempts = Number(retryTerminal.attempts ?? 0);

		const logsAfterRetryOutput = await runSubprocess(
			process.execPath,
			[
				"scripts/ci/task-smoke-cli.mjs",
				"logs",
				effortId,
				"--transport",
				"http",
				"--json",
			],
			{ env, captureOutput: true },
		);
		const logsAfterRetryPayload = parseJsonOutput(logsAfterRetryOutput.stdout);
		const logsAfterRetry = Array.isArray(logsAfterRetryPayload.logs)
			? logsAfterRetryPayload.logs
			: [];
		if (!logsAfterRetry.some((entry) => entry?.event === "retry_requested")) {
			throw new Error("Expected retry_requested event after retry command");
		}
		const finishedCount = logsAfterRetry.filter(
			(entry) => entry?.event === "processing_finished",
		).length;
		if (finishedCount < 2) {
			throw new Error(
				`Expected >=2 processing_finished events after retry, got ${finishedCount}`,
			);
		}

		console.log(
			`[task-smoke] passed: effort=${effortId} status=${retryTerminal.status} attempts=${retryAttempts}`,
		);
	} catch (error) {
		const details = error instanceof Error ? error.message : String(error);
		const tail = farmhandLogs.split("\n").filter(Boolean).slice(-40).join("\n");
		throw new Error(
			`[task-smoke] failed: ${details}${tail ? `\n--- farmhand logs (tail) ---\n${tail}` : ""}`,
		);
	} finally {
		await stopProcess(farmhand);
		if (!keepArtifacts) {
			await rm(tempHome, { recursive: true, force: true });
		} else {
			console.log(`[task-smoke] kept HOME artifact at ${tempHome}`);
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
