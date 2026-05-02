#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	parseJsonOutput,
	runSubprocess,
	stripAnsi,
} from "./subprocess-utils.mjs";

const LOGGER_PREFIX = "[refarm-host-cli-smoke]";

function makeStatusPayload(mode) {
	const kind = mode;
	const rendererId = `refarm-${mode}`;
	const capabilities =
		mode === "web"
			? ["interactive", "rich-html", "diagnostics"]
			: ["interactive", "diagnostics"];

	return {
		schemaVersion: 1,
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode,
		},
		renderer: {
			id: rendererId,
			kind,
			capabilities,
		},
		runtime: {
			ready: true,
			namespace: "refarm-main",
			databaseName: "refarm-main",
		},
		plugins: {
			installed: 0,
			active: 0,
			rejectedSurfaces: 0,
			surfaceActions: 0,
		},
		trust: {
			profile: "dev",
			warnings: 0,
			critical: 0,
		},
		streams: {
			active: 0,
			terminal: 0,
		},
		diagnostics: [],
	};
}

function assertIncludes(output, expected) {
	if (!output.includes(expected)) {
		throw new Error(
			`Expected command output to include ${JSON.stringify(expected)}. Output:\n${output}`,
		);
	}
}

async function main() {
	const keepArtifacts =
		process.env.REFARM_HOST_SMOKE_KEEP_ARTIFACTS === "1" ||
		process.env.REFARM_HOST_SMOKE_KEEP_ARTIFACTS === "true";

	const tempDir = await mkdtemp(path.join(tmpdir(), "refarm-host-cli-smoke-"));
	const webStatusPath = path.join(tempDir, "status-web.json");
	const tuiStatusPath = path.join(tempDir, "status-tui.json");

	try {
		await writeFile(
			webStatusPath,
			`${JSON.stringify(makeStatusPayload("web"), null, 2)}\n`,
			"utf8",
		);
		await writeFile(
			tuiStatusPath,
			`${JSON.stringify(makeStatusPayload("tui"), null, 2)}\n`,
			"utf8",
		);

		console.log(`${LOGGER_PREFIX} building apps/refarm dist...`);
		await runSubprocess("npm", ["--prefix", "apps/refarm", "run", "build"], {
			env: process.env,
		});

		console.log(
			`${LOGGER_PREFIX} smoke: refarm web --launch --dry-run --open --input`,
		);
		const webRun = await runSubprocess(
			process.execPath,
			[
				"--experimental-loader",
				"./scripts/ci/esm-extension-loader.mjs",
				"apps/refarm/dist/index.js",
				"web",
				"--input",
				webStatusPath,
				"--launch",
				"--dry-run",
				"--open",
			],
			{ env: process.env, captureOutput: true },
		);
		const webOutput = stripAnsi(`${webRun.stdout}\n${webRun.stderr}`);
		assertIncludes(webOutput, "[dry-run] would launch web runtime");
		assertIncludes(webOutput, "[dry-run] would open browser URL");

		console.log(`${LOGGER_PREFIX} smoke: refarm tui --json --input`);
		const tuiJsonRun = await runSubprocess(
			process.execPath,
			[
				"--experimental-loader",
				"./scripts/ci/esm-extension-loader.mjs",
				"apps/refarm/dist/index.js",
				"tui",
				"--input",
				tuiStatusPath,
				"--json",
			],
			{ env: process.env, captureOutput: true },
		);
		let tuiJson;
		try {
			tuiJson = parseJsonOutput(tuiJsonRun.stdout);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stderr = stripAnsi(tuiJsonRun.stderr ?? "").trim();
			throw new Error(
				`Failed to parse tui --json output: ${message}${stderr ? `\n--- stderr ---\n${stderr}` : ""}`,
			);
		}
		if (tuiJson?.renderer?.kind !== "tui") {
			throw new Error(
				`Expected tui renderer kind from JSON output, got: ${JSON.stringify(tuiJson?.renderer)}`,
			);
		}

		console.log(
			`${LOGGER_PREFIX} smoke: refarm tui --launch --dry-run --input`,
		);
		const tuiLaunchRun = await runSubprocess(
			process.execPath,
			[
				"--experimental-loader",
				"./scripts/ci/esm-extension-loader.mjs",
				"apps/refarm/dist/index.js",
				"tui",
				"--input",
				tuiStatusPath,
				"--launch",
				"--dry-run",
			],
			{ env: process.env, captureOutput: true },
		);
		const tuiLaunchOutput = stripAnsi(
			`${tuiLaunchRun.stdout}\n${tuiLaunchRun.stderr}`,
		);
		assertIncludes(tuiLaunchOutput, "[dry-run] would launch tui runtime");

		console.log(`${LOGGER_PREFIX} passed`);
	} finally {
		if (!keepArtifacts) {
			await rm(tempDir, { recursive: true, force: true });
		} else {
			console.log(`${LOGGER_PREFIX} kept artifacts at ${tempDir}`);
		}
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`${LOGGER_PREFIX} failed: ${message}`);
	process.exit(1);
});
