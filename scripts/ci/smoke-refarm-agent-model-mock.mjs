#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

async function stopRuntime(env) {
	await runSubprocess(process.execPath, ["scripts/agent-stop.mjs"], {
		cwd: ROOT,
		env,
		captureOutput: true,
	});
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
	const identityFile = path.join(tempDir, "identity.json");
	const mock = await createModelMock({ repeatLast: true });
	mock.queue(says(EXPECTED_RESPONSE));

	const env = {
		...process.env,
		...mock.env,
		REFARM_STREAMS_DIR: streamsDir,
		REFARM_OPERATOR_IDENTITY_FILE: identityFile,
		REFARM_NO_BROWSER_OPEN: "1",
	};

	try {
		await mkdir(streamsDir, { recursive: true });
		await stopRuntime(env);

		const started = await runRefarm(["runtime", "start", "--wait", "--json"], env);
		assert(started.ok === true, `runtime start failed: ${JSON.stringify(started)}`);
		assert(
			started.ready === true || started.status === "ready",
			`runtime did not report ready: ${JSON.stringify(started)}`,
		);

		const pluginStatus = await runRefarm(["plugin", "status", "--json"], env);
		assert(
			pluginStatus.ok === true,
			`plugin status failed: ${JSON.stringify(pluginStatus)}`,
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

		assert(mock.requests.length > 0, "model mock did not capture any requests");
		const lastRequest = mock.requests.at(-1);
		const userMessages = lastRequest.messages
			.filter((message) => message.role === "user")
			.map((message) => String(message.content ?? ""));
		assert(
			userMessages.some((content) => content.includes("refarm model mock e2e ok")),
			`mock request did not include the ask prompt: ${JSON.stringify(lastRequest)}`,
		);

		const streamFiles = await listStreamFiles(streamsDir);
		assert(
			streamFiles.length > 0,
			`pi-agent did not create stream files under ${streamsDir}`,
		);

		console.log(
			JSON.stringify(
				{
					ok: true,
					runtime: "ready",
					modelProvider: mock.env.MODEL_PROVIDER,
					modelBaseUrl: mock.env.MODEL_BASE_URL,
					modelRequests: mock.requests.length,
					streamFiles: streamFiles.length,
					nextCommands: ask.nextCommands,
				},
				null,
				2,
			),
		);
	} finally {
		try {
			await stopRuntime(env);
		} finally {
			await mock.stop();
			await rm(tempDir, { recursive: true, force: true });
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
