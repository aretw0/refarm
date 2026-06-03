#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createModelMock, says } from "../../packages/model-mock/dist/index.js";
import {
	parseJsonOutput,
	runSubprocess,
} from "./subprocess-utils.mjs";

const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);
const REFARM_CLI = path.join("apps", "refarm", "dist", "index.js");
const EXPECTED_RESPONSE = "refarm model mock e2e ok";
const EXPECTED_TASK_RESPONSE = "refarm task runtime agent mock e2e ok";

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function runRefarm(args, env) {
	const { stdout } = await runSubprocess(
		process.execPath,
		[REFARM_CLI, ...args],
		{
			cwd: ROOT,
			env,
			captureOutput: true,
		},
	);
	return parseJsonOutput(stdout);
}

async function runRefarmJsonResult(args, env) {
	try {
		return await runRefarm(args, env);
	} catch (error) {
		if (error instanceof Error) {
			return parseJsonOutput(error.message);
		}
		throw error;
	}
}

async function runRefarmHandoff(command, env) {
	assert(command.startsWith("refarm "), `unsupported handoff command: ${command}`);
	return runRefarm(command.split(/\s+/).slice(1), env);
}

async function waitForTaskDone(effortId, env, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	let lastStatus;
	while (Date.now() < deadline) {
		lastStatus = await runRefarm(
			["task", "status", effortId, "--transport", "http", "--json"],
			env,
		);
		if (["done", "failed"].includes(String(lastStatus.status))) {
			return lastStatus;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(
		`task ${effortId} did not finish before timeout: ${JSON.stringify(lastStatus)}`,
	);
}

async function runtimeReady(env) {
	const status = await runRefarm(["runtime", "status", "--json"], env);
	return status.ready === true || status.status === "ready";
}

async function getFreePort() {
	const server = net.createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	await new Promise((resolve) => server.close(resolve));
	assert(address && typeof address === "object", "free port probe did not return an address");
	return address.port;
}

function cargoTargetDir() {
	if (process.env.CARGO_TARGET_DIR) return path.resolve(process.env.CARGO_TARGET_DIR);
	return "/home/vscode/.cargo-target";
}

function runtimeArtifact(relativePath) {
	return path.join(cargoTargetDir(), relativePath);
}

function startMockRuntime(env, options) {
	const tractor = runtimeArtifact(path.join("release", "tractor"));
	const installedAgentPlugin = path.join(
		String(env.HOME),
		".refarm",
		"plugins",
		"@refarm",
		"pi-agent",
		"plugin.wasm",
	);
	const agentPluginWasm = existsSync(installedAgentPlugin)
		? installedAgentPlugin
		: runtimeArtifact(path.join("wasm32-wasip1", "release", "pi_agent.wasm"));
	assert(existsSync(tractor), `tractor binary missing: ${tractor}`);
	assert(existsSync(agentPluginWasm), `runtime agent WASM missing: ${agentPluginWasm}`);

	const child = spawn(
		tractor,
		[
			"--namespace",
			options.namespace,
			"--port",
			String(options.wsPort),
			"--http-port",
			String(options.httpPort),
			"--refarm-dir",
			options.refarmDir,
			"--plugin",
			agentPluginWasm,
		],
		{
			cwd: ROOT,
			env,
			stdio: ["ignore", "ignore", "pipe"],
		},
	);
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString();
	});
	child.on("exit", (code, signal) => {
		if (code !== null && code !== 0) {
			console.error(`mock runtime exited with code ${code}: ${stderr.trim()}`);
		} else if (signal && signal !== "SIGTERM") {
			console.error(`mock runtime exited with signal ${signal}: ${stderr.trim()}`);
		}
	});
	return {
		async stop() {
			if (child.exitCode !== null || child.signalCode !== null) return;
			child.kill("SIGTERM");
			await new Promise((resolve) => child.once("exit", resolve));
		},
	};
}

async function waitForMockRuntime(env, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	let lastError;
	while (Date.now() < deadline) {
		try {
			if (await runtimeReady(env)) return;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(
		`mock runtime did not become ready${lastError ? `: ${lastError.message}` : ""}`,
	);
}

async function listStreamFiles(streamsDir) {
	if (!existsSync(streamsDir)) return [];
	const entries = await readdir(streamsDir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ndjson"))
		.map((entry) => path.join(streamsDir, entry.name));
}

async function main() {
	const tempDir = await mkdtemp(path.join(tmpdir(), "refarm-agent-mock-"));
	const streamsDir = path.join(tempDir, "streams");
	const refarmHomeDir = path.join(tempDir, ".refarm");
	const identityFile = path.join(refarmHomeDir, "identity.json");
	const wsPort = await getFreePort();
	const httpPort = await getFreePort();
	const namespace = `refarm-agent-mock-${process.pid}`;
	const mock = await createModelMock({ repeatLast: true });
	mock.queue(says(EXPECTED_RESPONSE));
	mock.queue(says(EXPECTED_TASK_RESPONSE));

	const baseEnv = {
		...process.env,
		REFARM_NO_BROWSER_OPEN: "1",
	};
	const env = {
		...baseEnv,
		...mock.env,
		HOME: tempDir,
		REFARM_SIDECAR_URL: `http://127.0.0.1:${httpPort}`,
		REFARM_STREAMS_DIR: streamsDir,
		REFARM_OPERATOR_IDENTITY_FILE: identityFile,
	};
	let runtime;

	try {
		await mkdir(streamsDir, { recursive: true });
		await mkdir(refarmHomeDir, { recursive: true });
		await writeFile(
			identityFile,
			JSON.stringify(
				{
					tokens: {
						modelProvider: mock.env.MODEL_PROVIDER,
						modelId: mock.env.MODEL_ID,
						modelBaseUrl: mock.env.MODEL_BASE_URL,
						modelApiKey: mock.env.OPENAI_API_KEY,
					},
					updatedAt: new Date(0).toISOString(),
				},
				null,
				2,
			),
		);
		await runRefarm(["plugin", "update", "--json"], env);
		runtime = startMockRuntime(env, {
			httpPort,
			namespace,
			refarmDir: refarmHomeDir,
			wsPort,
		});
		await waitForMockRuntime(env);

		const pluginReload = await runRefarmJsonResult(
			["plugin", "reload", "runtime-agent", "--json"],
			env,
		);
		assert(
			pluginReload.command === "plugin" && pluginReload.operation === "reload",
			`runtime-agent plugin reload returned unexpected payload: ${JSON.stringify(pluginReload)}`,
		);
		assert(
			pluginReload.requested?.includes("runtime-agent") &&
				[
					...(pluginReload.reloaded ?? []),
					...(pluginReload.skipped ?? []),
				].includes("@refarm/pi-agent"),
			`runtime-agent plugin reload did not normalize alias to physical plugin id: ${JSON.stringify(pluginReload)}`,
		);
		assert(
			pluginReload.nextCommand === "refarm plugin status --json",
			`runtime-agent plugin reload did not expose status handoff: ${JSON.stringify(pluginReload)}`,
		);
		const pluginStatus = await runRefarmHandoff(pluginReload.nextCommand, env);
		assert(
			pluginStatus.ok === true &&
				pluginStatus.plugins?.some(
					(plugin) => plugin.id === "@refarm/pi-agent" && plugin.loaded === true,
				),
			`runtime-agent plugin status handoff did not report loaded plugin: ${JSON.stringify(pluginStatus)}`,
		);

		const ask = await runRefarm(
			["ask", "responda exatamente: refarm model mock e2e ok", "--json"],
			env,
		);
		assert(ask.ok === true, `ask failed: ${JSON.stringify(ask)}`);
		assert(
			typeof ask.content === "string" && ask.content.includes(EXPECTED_RESPONSE),
			`ask content did not include mock response: ${JSON.stringify(ask)}`,
		);
		assert(
			ask.metadata?.source !== "session-history",
			`ask fell back to session history instead of runtime stream: ${JSON.stringify(ask)}`,
		);
		assert(
			Array.isArray(ask.nextCommands) && ask.nextCommands.length > 0,
			`ask did not expose nextCommands: ${JSON.stringify(ask)}`,
		);
		const showSessionCommand = ask.nextCommands.find((command) =>
			command.startsWith("refarm sessions show "),
		);
		assert(
			typeof showSessionCommand === "string",
			`ask did not expose a sessions show nextCommand: ${JSON.stringify(ask)}`,
		);
		const session = await runRefarmHandoff(showSessionCommand, env);
		assert(
			session.session?.participants?.includes("urn:refarm:agent:runtime-agent"),
			`runtime agent session participant missing: ${JSON.stringify(session)}`,
		);
		assert(
			!session.session?.participants?.includes("urn:refarm:agent:pi-agent"),
			`legacy pi-agent participant leaked into new session: ${JSON.stringify(session)}`,
		);

		const taskRun = await runRefarm(
			[
				"task",
				"run",
				"runtime-agent",
				"respond",
				"--transport",
				"http",
				"--args",
				JSON.stringify({
					prompt: "responda exatamente: refarm task runtime agent mock e2e ok",
				}),
				"--json",
			],
			env,
		);
		assert(taskRun.ok === true, `task run failed: ${JSON.stringify(taskRun)}`);
		assert(
			taskRun.plugin === "runtime-agent",
			`task run did not preserve requested operator alias: ${JSON.stringify(taskRun)}`,
		);
		assert(
			taskRun.effort?.tasks?.[0]?.pluginId === "@refarm/pi-agent",
			`task run did not normalize runtime-agent to physical plugin id: ${JSON.stringify(taskRun)}`,
		);
		assert(
			Array.isArray(taskRun.nextCommands) &&
				taskRun.nextCommands.some((command) =>
					command.startsWith(`refarm task status ${taskRun.effortId} --transport http`),
				),
			`task run did not expose status nextCommands: ${JSON.stringify(taskRun)}`,
		);
		const taskResume = await runRefarm(["task", "resume", "--json"], env);
		assert(
			taskResume.status === "ok" &&
				taskResume.checkpoint?.activeEffortId === taskRun.effortId,
			`task resume did not expose the active runtime-agent effort: ${JSON.stringify(taskResume)}`,
		);
		assert(
			taskResume.nextCommands?.includes(
				`refarm task status ${taskRun.effortId} --transport http --watch --json`,
			) &&
				taskResume.nextCommands?.includes(
					`refarm task logs ${taskRun.effortId} --transport http --json`,
				),
			`task resume did not expose active status/log continuations: ${JSON.stringify(taskResume)}`,
		);
		const taskStatus = await waitForTaskDone(taskRun.effortId, env);
		assert(
			taskStatus.status === "done",
			`runtime-agent task did not finish successfully: ${JSON.stringify(taskStatus)}`,
		);
		assert(
			taskStatus.result?.results?.some((result) => result.status === "ok"),
			`runtime-agent task status did not include an ok task result: ${JSON.stringify(taskStatus)}`,
		);
		const statusCommand = taskRun.nextCommands.find(
			(command) =>
				command ===
				`refarm task status ${taskRun.effortId} --transport http --json`,
		);
		assert(
			typeof statusCommand === "string",
			`task run did not expose executable status JSON handoff: ${JSON.stringify(taskRun)}`,
		);
		const statusFromHandoff = await runRefarmHandoff(statusCommand, env);
		assert(
			statusFromHandoff.status === "done",
			`task status handoff did not report done: ${JSON.stringify(statusFromHandoff)}`,
		);
		const taskResumeAfterDone = await runRefarm(["task", "resume", "--json"], env);
		assert(
			Array.isArray(taskResumeAfterDone.nextCommands) &&
				taskResumeAfterDone.nextCommands.length === 0,
			`task resume exposed misleading continuations for terminal effort: ${JSON.stringify(taskResumeAfterDone)}`,
		);
		assert(
			taskResumeAfterDone.effortCommands?.some(
				(effort) =>
					effort.effortId === taskRun.effortId &&
					effort.statusCommand ===
						`refarm task status ${taskRun.effortId} --transport http --json` &&
					effort.logsCommand ===
						`refarm task logs ${taskRun.effortId} --transport http --json`,
			),
			`task resume did not preserve terminal effort status/log handoffs: ${JSON.stringify(taskResumeAfterDone)}`,
		);
		const operatorResume = await runRefarm(["resume", "--json"], env);
		assert(
			operatorResume.ok === true && operatorResume.runtime?.ready === true,
			`operator resume did not report ready runtime: ${JSON.stringify(operatorResume)}`,
		);
		assert(
			operatorResume.tasks?.recentEfforts?.some(
				(effort) =>
					effort.effortId === taskRun.effortId &&
					effort.lastStatus === "done" &&
					effort.statusCommand ===
						`refarm task status ${taskRun.effortId} --transport http --json` &&
					effort.logsCommand ===
						`refarm task logs ${taskRun.effortId} --transport http --json`,
			),
			`operator resume did not preserve terminal task handoffs: ${JSON.stringify(operatorResume)}`,
		);
		assert(
			!operatorResume.nextCommands?.includes("refarm task resume --json"),
			`operator resume suggested task resume for terminal effort: ${JSON.stringify(operatorResume)}`,
		);
		const logsCommand = taskRun.nextCommands.find(
			(command) =>
				command === `refarm task logs ${taskRun.effortId} --transport http --json`,
		);
		assert(
			typeof logsCommand === "string",
			`task run did not expose executable logs JSON handoff: ${JSON.stringify(taskRun)}`,
		);
		const logsFromHandoff = await runRefarmHandoff(logsCommand, env);
		assert(
			logsFromHandoff.ok === true && logsFromHandoff.operation === "logs",
			`task logs handoff failed: ${JSON.stringify(logsFromHandoff)}`,
		);

		assert(mock.requests.length >= 2, "model mock did not capture ask and task requests");
		const lastRequest = mock.requests.at(-1);
		const userMessages = lastRequest.messages
			.filter((message) => message.role === "user")
			.map((message) => String(message.content ?? ""));
		assert(
			userMessages.some((content) =>
				content.includes("refarm task runtime agent mock e2e ok"),
			),
			`mock request did not include the runtime-agent task prompt: ${JSON.stringify(lastRequest)}`,
		);

		const streamFiles = await listStreamFiles(streamsDir);
		assert(
			streamFiles.length > 0,
			`runtime agent did not create stream files under ${streamsDir}`,
		);

		console.log(
			JSON.stringify(
				{
					ok: true,
					runtime: "ready",
					httpPort,
					modelProvider: mock.env.MODEL_PROVIDER,
					modelBaseUrl: mock.env.MODEL_BASE_URL,
					modelRequests: mock.requests.length,
					streamFiles: streamFiles.length,
					pluginReloadNextCommands: pluginReload.nextCommands,
					askNextCommands: ask.nextCommands,
					taskNextCommands: taskRun.nextCommands,
					taskResumeNextCommands: taskResume.nextCommands,
					operatorResumeNextCommands: operatorResume.nextCommands,
				},
				null,
				2,
			),
		);
	} finally {
		try {
			await runtime?.stop();
		} finally {
			try {
				await mock.stop();
			} finally {
				await rm(tempDir, { recursive: true, force: true });
			}
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
