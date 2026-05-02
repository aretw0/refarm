#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMockManifest } from "@refarm.dev/plugin-manifest";
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

function extractEffortId(output) {
	const cleaned = stripAnsi(output);
	const match = cleaned.match(/Effort dispatched:\s*([0-9a-fA-F-]{36})/);
	if (!match) {
		throw new Error(`Could not parse effort id from output:\n${cleaned}`);
	}
	return match[1];
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

async function waitForTerminalStatus({ env, effortId, timeoutMs = 45_000 }) {
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

function normalizeRespondResult(raw) {
	if (raw && typeof raw === "object") return raw;
	if (typeof raw !== "string") return null;
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

async function installPiAgentPlugin(tempHome, wasmSourcePath) {
	const pluginDir = path.join(tempHome, ".refarm", "plugins", "pi-agent");
	await mkdir(pluginDir, { recursive: true });

	const wasmDestPath = path.join(pluginDir, "pi-agent.wasm");
	await cp(wasmSourcePath, wasmDestPath);

	const wasmBuffer = await readFile(wasmDestPath);
	const integrity = `sha256-${createHash("sha256").update(wasmBuffer).digest("hex")}`;

	const manifest = createMockManifest({
		id: "@refarm/pi-agent",
		name: "Pi Agent",
		entry: pathToFileURL(wasmDestPath).href,
		integrity,
		targets: ["server"],
		capabilities: {
			provides: ["ai:respond"],
			requires: [],
			providesApi: [],
			requiresApi: [],
		},
		permissions: [
			"store:UserPrompt",
			"store:AgentResponse",
			"store:UsageRecord",
		],
	});

	await writeFile(
		path.join(pluginDir, "plugin.json"),
		JSON.stringify(manifest, null, 2),
		"utf-8",
	);
}

async function main() {
	const keepArtifacts =
		process.env.REFARM_TASK_SMOKE_KEEP_ARTIFACTS === "1" ||
		process.env.REFARM_TASK_SMOKE_KEEP_ARTIFACTS === "true";

	const tempHome = await mkdtemp(path.join(tmpdir(), "refarm-task-pi-agent-"));
	let farmhand = null;
	let farmhandLogs = "";

	try {
		const skipAppBuilds =
			process.env.REFARM_TASK_SMOKE_PI_AGENT_SKIP_APP_BUILDS === "1";
		const skipWasmBuild =
			process.env.REFARM_TASK_SMOKE_PI_AGENT_SKIP_WASM_BUILD === "1";

		if (!skipAppBuilds) {
			await prepareTaskSmokeTypeBuilds(process.env, "[task-smoke:pi-agent]");
		} else {
			console.log(
				"[task-smoke:pi-agent] skipping app builds (REFARM_TASK_SMOKE_PI_AGENT_SKIP_APP_BUILDS=1)",
			);
		}

		const wasmPath = path.join(
			process.cwd(),
			"packages/pi-agent/target/wasm32-wasip1/release/pi_agent.wasm",
		);
		if (!skipWasmBuild && !existsSync(wasmPath)) {
			console.log("[task-smoke:pi-agent] building pi-agent wasm component...");
			await runSubprocess("cargo", ["component", "build", "--release"], {
				cwd: "packages/pi-agent",
			});
		} else if (skipWasmBuild) {
			console.log(
				"[task-smoke:pi-agent] skipping wasm build (REFARM_TASK_SMOKE_PI_AGENT_SKIP_WASM_BUILD=1)",
			);
		} else {
			console.log(
				"[task-smoke:pi-agent] reusing existing pi-agent wasm artifact",
			);
		}
		await installPiAgentPlugin(tempHome, wasmPath);

		const env = {
			...process.env,
			HOME: tempHome,
			USERPROFILE: tempHome,
			LLM_PROVIDER: "ollama",
			LLM_MODEL: "smoke-pi-agent-model",
			LLM_HISTORY_TURNS: "0",
			REFARM_MOCK_LLM_BODY: JSON.stringify({
				id: "smoke-pi-agent",
				object: "chat.completion",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: "smoke-pi-agent: resposta determinística do mock LLM",
						},
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 19,
					completion_tokens: 11,
					total_tokens: 30,
				},
			}),
		};

		console.log("[task-smoke:pi-agent] starting farmhand daemon...");
		farmhand = spawn(
			process.execPath,
			[
				"--experimental-loader",
				"./scripts/ci/esm-extension-loader.mjs",
				"apps/farmhand/dist/index.js",
			],
			{
				env,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
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
		console.log("[task-smoke:pi-agent] farmhand sidecar is ready");

		const runOutput = await runSubprocess(
			process.execPath,
			[
				"scripts/ci/task-smoke-cli.mjs",
				"run",
				"@refarm/pi-agent",
				"respond",
				"--args",
				'{"prompt":"Responda com uma frase curta para smoke e2e"}',
				"--direction",
				"CI smoke pi-agent respond",
				"--transport",
				"http",
			],
			{ env, captureOutput: true },
		);

		const effortId = extractEffortId(
			`${runOutput.stdout}\n${runOutput.stderr}`,
		);
		console.log(`[task-smoke:pi-agent] effort dispatched: ${effortId}`);

		const terminal = await waitForTerminalStatus({ env, effortId });
		if (terminal.status !== "done") {
			throw new Error(
				`Expected done status for pi-agent smoke effort, got ${terminal.status}`,
			);
		}

		const taskResult = terminal?.result?.results?.[0];
		if (!taskResult || taskResult.status !== "ok") {
			throw new Error(
				`Expected first task result status=ok, got: ${JSON.stringify(taskResult)}`,
			);
		}

		const respondResult = normalizeRespondResult(taskResult.result);
		if (!respondResult) {
			throw new Error(
				`Expected JSON respond payload, got: ${JSON.stringify(taskResult.result)}`,
			);
		}

		const usage = respondResult.usage;
		if (
			typeof respondResult.content !== "string" ||
			typeof respondResult.model !== "string" ||
			typeof respondResult.provider !== "string" ||
			!usage ||
			typeof usage !== "object" ||
			typeof usage.tokens_in !== "number" ||
			typeof usage.tokens_out !== "number" ||
			typeof usage.estimated_usd !== "number"
		) {
			throw new Error(
				`respond payload missing expected fields: ${JSON.stringify(respondResult)}`,
			);
		}

		console.log(
			`[task-smoke:pi-agent] passed: effort=${effortId} provider=${respondResult.provider} model=${respondResult.model}`,
		);
	} catch (error) {
		const details = error instanceof Error ? error.message : String(error);
		const tail = farmhandLogs.split("\n").filter(Boolean).slice(-60).join("\n");
		throw new Error(
			`[task-smoke:pi-agent] failed: ${details}${tail ? `\n--- farmhand logs (tail) ---\n${tail}` : ""}`,
		);
	} finally {
		await stopProcess(farmhand);

		if (!keepArtifacts) {
			await rm(tempHome, { recursive: true, force: true });
		} else {
			console.log(`[task-smoke:pi-agent] kept HOME artifact at ${tempHome}`);
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
