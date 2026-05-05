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
const REFARM_DIST_ENTRY = "apps/refarm/dist/index.js";
const REFARM_NODE_ARGS_PREFIX = [
	"--experimental-loader",
	"./scripts/ci/esm-extension-loader.mjs",
	REFARM_DIST_ENTRY,
];

function makeStatusPayload(mode, options = {}) {
	const diagnostics = options.diagnostics ?? [];
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
			ready: !diagnostics.includes("runtime:not-ready"),
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
			warnings: diagnostics.includes("trust:warnings-present") ? 1 : 0,
			critical: diagnostics.includes("trust:critical-present") ? 1 : 0,
		},
		streams: {
			active: 0,
			terminal: 0,
		},
		diagnostics,
	};
}

function buildRefarmCommandArgs(args) {
	return [...REFARM_NODE_ARGS_PREFIX, ...args];
}

async function runRefarmCommand(args, options = {}) {
	return runSubprocess(process.execPath, buildRefarmCommandArgs(args), {
		env: {
			...process.env,
			NODE_NO_WARNINGS: "1",
			...(options.env ?? {}),
		},
		captureOutput: options.captureOutput ?? true,
	});
}

function assertIncludes(output, expected) {
	if (!output.includes(expected)) {
		throw new Error(
			`Expected command output to include ${JSON.stringify(expected)}. Output:\n${output}`,
		);
	}
}

function assertNotIncludes(output, expected) {
	if (output.includes(expected)) {
		throw new Error(
			`Expected command output to exclude ${JSON.stringify(expected)}. Output:\n${output}`,
		);
	}
}

function parseCommandJsonOutput(label, runResult) {
	try {
		return parseJsonOutput(runResult.stdout);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const stderr = stripAnsi(runResult.stderr ?? "").trim();
		throw new Error(
			`Failed to parse ${label} JSON output: ${message}${stderr ? `\n--- stderr ---\n${stderr}` : ""}`,
		);
	}
}

async function assertCommandFailsWith(args, expectedSubstring) {
	try {
		await runRefarmCommand(args);
		throw new Error(
			`Expected command to fail with ${JSON.stringify(expectedSubstring)}, but it exited successfully.`,
		);
	} catch (error) {
		const output = stripAnsi(
			error instanceof Error ? error.message : String(error),
		);
		assertIncludes(output, expectedSubstring);
	}
}

async function main() {
	const keepArtifacts =
		process.env.REFARM_HOST_SMOKE_KEEP_ARTIFACTS === "1" ||
		process.env.REFARM_HOST_SMOKE_KEEP_ARTIFACTS === "true";

	const tempDir = await mkdtemp(path.join(tmpdir(), "refarm-host-cli-smoke-"));
	const webStatusPath = path.join(tempDir, "status-web.json");
	const tuiStatusPath = path.join(tempDir, "status-tui.json");
	const warningStatusPath = path.join(tempDir, "status-warning.json");

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
		await writeFile(
			warningStatusPath,
			`${JSON.stringify(makeStatusPayload("headless", { diagnostics: ["trust:warnings-present"] }), null, 2)}\n`,
			"utf8",
		);

		console.log(`${LOGGER_PREFIX} building apps/refarm dist...`);
		await runSubprocess("npm", ["--prefix", "apps/refarm", "run", "build"], {
			env: process.env,
		});

		console.log(`${LOGGER_PREFIX} smoke: refarm web --input preflight hint`);
		const webPreflightRun = await runRefarmCommand([
			"web",
			"--input",
			webStatusPath,
		]);
		const webPreflightOutput = stripAnsi(
			`${webPreflightRun.stdout}\n${webPreflightRun.stderr}`,
		);
		assertIncludes(webPreflightOutput, "available via --launch");
		assertIncludes(webPreflightOutput, "(dev|preview)");

		console.log(`${LOGGER_PREFIX} smoke: refarm --version resolves from env`);
		const versionRun = await runRefarmCommand(["--version"], {
			env: { ...process.env, REFARM_VERSION: "9.9.9-test" },
		});
		const versionOutput = stripAnsi(
			`${versionRun.stdout}\n${versionRun.stderr}`,
		);
		assertIncludes(versionOutput, "9.9.9-test");

		console.log(`${LOGGER_PREFIX} smoke: refarm tui --input preflight hint`);
		const tuiPreflightRun = await runRefarmCommand([
			"tui",
			"--input",
			tuiStatusPath,
		]);
		const tuiPreflightOutput = stripAnsi(
			`${tuiPreflightRun.stdout}\n${tuiPreflightRun.stderr}`,
		);
		assertIncludes(tuiPreflightOutput, "available via --launch");
		assertIncludes(tuiPreflightOutput, "(watch|prompt)");

		console.log(
			`${LOGGER_PREFIX} smoke: refarm web --launch --dry-run --open --input`,
		);
		const webRun = await runRefarmCommand([
			"web",
			"--input",
			webStatusPath,
			"--launch",
			"--dry-run",
			"--open",
		]);
		const webOutput = stripAnsi(`${webRun.stdout}\n${webRun.stderr}`);
		assertIncludes(webOutput, "REFARM");
		assertIncludes(webOutput, "version:");
		assertIncludes(webOutput, "[dry-run] would launch web runtime");
		assertIncludes(webOutput, "[dry-run] would open browser URL");

		console.log(
			`${LOGGER_PREFIX} smoke: refarm web launch banner can be disabled`,
		);
		const webNoBannerRun = await runRefarmCommand(
			["web", "--input", webStatusPath, "--launch", "--dry-run"],
			{ env: { ...process.env, REFARM_BRAND_BANNER: "0" } },
		);
		const webNoBannerOutput = stripAnsi(
			`${webNoBannerRun.stdout}\n${webNoBannerRun.stderr}`,
		);
		assertNotIncludes(webNoBannerOutput, "REFARM");
		assertNotIncludes(webNoBannerOutput, "version:");
		assertIncludes(webNoBannerOutput, "[dry-run] would launch web runtime");

		console.log(`${LOGGER_PREFIX} smoke: refarm tui --json --input`);
		const tuiJsonRun = await runRefarmCommand([
			"tui",
			"--input",
			tuiStatusPath,
			"--json",
		]);
		const tuiJson = parseCommandJsonOutput("tui --json", tuiJsonRun);
		if (tuiJson?.renderer?.kind !== "tui") {
			throw new Error(
				`Expected tui renderer kind from JSON output, got: ${JSON.stringify(tuiJson?.renderer)}`,
			);
		}

		console.log(`${LOGGER_PREFIX} smoke: refarm status --json --input`);
		const statusJsonRun = await runRefarmCommand([
			"status",
			"--input",
			webStatusPath,
			"--json",
		]);
		const statusJson = parseCommandJsonOutput("status --json", statusJsonRun);
		if (statusJson?.renderer?.kind !== "web") {
			throw new Error(
				`Expected status renderer kind=web from input artifact, got: ${JSON.stringify(statusJson?.renderer)}`,
			);
		}

		console.log(`${LOGGER_PREFIX} smoke: refarm headless --input JSON output`);
		const headlessJsonRun = await runRefarmCommand([
			"headless",
			"--input",
			tuiStatusPath,
		]);
		const headlessJson = parseCommandJsonOutput("headless", headlessJsonRun);
		if (headlessJson?.renderer?.kind !== "tui") {
			throw new Error(
				`Expected headless passthrough renderer kind=tui from input artifact, got: ${JSON.stringify(headlessJson?.renderer)}`,
			);
		}

		console.log(`${LOGGER_PREFIX} smoke: refarm doctor --json --input`);
		const doctorJsonRun = await runRefarmCommand([
			"doctor",
			"--input",
			webStatusPath,
			"--json",
		]);
		const doctorJson = parseCommandJsonOutput("doctor --json", doctorJsonRun);
		if (typeof doctorJson?.host?.version !== "string") {
			throw new Error(
				`Expected doctor JSON host.version string, got: ${JSON.stringify(doctorJson?.host)}`,
			);
		}
		if (doctorJson?.status?.host?.app !== "apps/refarm") {
			throw new Error(
				`Expected doctor JSON status.host.app=apps/refarm, got: ${JSON.stringify(doctorJson?.status?.host)}`,
			);
		}

		console.log(`${LOGGER_PREFIX} smoke: refarm doctor --input summary output`);
		const doctorSummaryRun = await runRefarmCommand([
			"doctor",
			"--input",
			webStatusPath,
		]);
		const doctorSummaryOutput = stripAnsi(
			`${doctorSummaryRun.stdout}\n${doctorSummaryRun.stderr}`,
		);
		assertIncludes(doctorSummaryOutput, "Doctor: PASS");
		assertIncludes(doctorSummaryOutput, "Host: refarm");

		console.log(
			`${LOGGER_PREFIX} smoke: refarm doctor --fail-on-warnings is fail-closed`,
		);
		await assertCommandFailsWith(
			["doctor", "--input", warningStatusPath, "--fail-on-warnings"],
			"Doctor: FAIL",
		);

		console.log(
			`${LOGGER_PREFIX} smoke: refarm telemetry is fail-closed when farmhand is down`,
		);
		await assertCommandFailsWith(
			["telemetry", "--json", "--strict"],
			"farmhand is not running",
		);

		console.log(
			`${LOGGER_PREFIX} smoke: refarm tui --launch --dry-run --input`,
		);
		const tuiLaunchRun = await runRefarmCommand([
			"tui",
			"--input",
			tuiStatusPath,
			"--launch",
			"--dry-run",
		]);
		const tuiLaunchOutput = stripAnsi(
			`${tuiLaunchRun.stdout}\n${tuiLaunchRun.stderr}`,
		);
		assertIncludes(tuiLaunchOutput, "REFARM");
		assertIncludes(tuiLaunchOutput, "version:");
		assertIncludes(tuiLaunchOutput, "[dry-run] would launch tui runtime");

		console.log(
			`${LOGGER_PREFIX} smoke: invalid web launcher is rejected fail-closed`,
		);
		await assertCommandFailsWith(
			["web", "--input", webStatusPath, "--launch", "--launcher", "invalid"],
			"Invalid --launcher value",
		);

		console.log(
			`${LOGGER_PREFIX} smoke: invalid tui launcher is rejected fail-closed`,
		);
		await assertCommandFailsWith(
			["tui", "--input", tuiStatusPath, "--launch", "--launcher", "invalid"],
			"Invalid --launcher value",
		);

		console.log(
			`${LOGGER_PREFIX} smoke: --open without --launch is rejected fail-closed`,
		);
		await assertCommandFailsWith(
			["web", "--input", webStatusPath, "--open"],
			"--open requires --launch",
		);

		console.log(
			`${LOGGER_PREFIX} smoke: --dry-run without --launch is rejected fail-closed`,
		);
		await assertCommandFailsWith(
			["tui", "--input", tuiStatusPath, "--dry-run"],
			"--dry-run requires --launch",
		);

		console.log(
			`${LOGGER_PREFIX} smoke: --json with --markdown is rejected fail-closed`,
		);
		await assertCommandFailsWith(
			["web", "--input", webStatusPath, "--json", "--markdown"],
			"Choose only one output format",
		);

		console.log(
			`${LOGGER_PREFIX} smoke: status --json with --markdown is rejected fail-closed`,
		);
		await assertCommandFailsWith(
			["status", "--input", webStatusPath, "--json", "--markdown"],
			"Choose only one output format",
		);

		console.log(
			`${LOGGER_PREFIX} smoke: headless markdown+summary is rejected fail-closed`,
		);
		await assertCommandFailsWith(
			["headless", "--input", tuiStatusPath, "--markdown", "--summary"],
			"Choose only one output format",
		);

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
