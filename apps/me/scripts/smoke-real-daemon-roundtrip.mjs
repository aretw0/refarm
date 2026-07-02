import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startAstroDevServer } from "./lib/astro-dev-server.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appRoot, "../..");
const appPort = Number(process.env.REFARM_ME_REAL_DAEMON_SMOKE_PORT ?? "4332");
const timeoutMs = Number(process.env.REFARM_ME_SMOKE_TIMEOUT_MS ?? "30000");
const verbose = process.env.REFARM_ME_SMOKE_VERBOSE === "1";
const nodeId = `urn:refarm:me:real-daemon-roundtrip:${Date.now()}`;
const nodeType = "refarm:RealDaemonRoundtripProof";
const namespace = `refarm-me-real-daemon-${process.pid}-${Date.now()}`;
const consoleMessages = [];
const tractorOutput = [];
const tractorPath = await resolveTractorBinary(workspaceRoot);
const tractorPort = await reservePort();
const tempRoot = await mkdtemp("/tmp/refarm-me-real-daemon-");
const refarmHome = join(tempRoot, "refarm-home");
const xdgDataHome = join(tempRoot, "xdg-data");
let tractor = null;

const { appUrl, output, stop, waitForHttp } = startAstroDevServer({
	appRoot,
	port: appPort,
});

try {
	tractor = await startTractor({
		tractorPath,
		namespace,
		port: tractorPort,
		refarmHome,
		xdgDataHome,
	});
	await waitForTractor(`ws://127.0.0.1:${tractorPort}`, timeoutMs);
	await waitForHttp(timeoutMs);

	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		page.on("console", (message) =>
			consoleMessages.push(`${message.type()}: ${message.text()}`),
		);
		page.on("pageerror", (error) =>
			consoleMessages.push(`pageerror: ${error.message}`),
		);
		await page.addInitScript((input) => {
			globalThis.__REFARM_ME_BOOTSTRAP_SYNC_URL__ = input.wsUrl;
			globalThis.__REFARM_ME_REAL_DAEMON__ = { workbench: null };
			globalThis.__REFARM_ME_ON_WORKBENCH_READY__ = (workbench) => {
				globalThis.__REFARM_ME_REAL_DAEMON__.workbench = workbench;
			};
		}, {
			wsUrl: `ws://127.0.0.1:${tractorPort}`,
		});

		await page.goto(appUrl, {
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
		await page.waitForFunction(
			() => globalThis.__REFARM_ME_REAL_DAEMON__?.workbench,
			undefined,
			{ timeout: timeoutMs },
		);

		await stopProcess(tractor);
		tractor = null;
		await page.waitForFunction(
			() =>
				document
					.querySelector("[data-refarm-me-sync-status]")
					?.textContent?.trim() === "reconnecting",
			undefined,
			{ timeout: timeoutMs },
		);

		await page.evaluate(async (input) => {
			const workbench = globalThis.__REFARM_ME_REAL_DAEMON__.workbench;
			await workbench.storeLocalNode({
				id: input.nodeId,
				type: input.nodeType,
				context: "citizen",
				payload: JSON.stringify({
					source: "smoke-real-daemon-roundtrip",
					nodeId: input.nodeId,
				}),
				sourcePlugin: "apps/me:smoke",
			});
		}, {
			nodeId,
			nodeType,
		});

		tractor = await startTractor({
			tractorPath,
			namespace,
			port: tractorPort,
			refarmHome,
			xdgDataHome,
		});
		await waitForTractor(`ws://127.0.0.1:${tractorPort}`, timeoutMs);
		await waitForNodeInTractor({
			tractorPath,
			namespace,
			nodeId,
			nodeType,
			env: tractorEnv(refarmHome, xdgDataHome),
			timeoutMs,
		});

		console.log(
			`ok: apps/me offline node reached real Tractor read model (${nodeId})`,
		);
		if (verbose) {
			if (consoleMessages.length > 0) {
				console.log(`browser messages:\n${consoleMessages.join("\n")}`);
			}
			if (tractorOutput.length > 0) {
				console.log(`tractor output:\n${tractorOutput.join("")}`);
			}
		}
	} finally {
		await browser.close();
	}
} catch (error) {
	console.error(error);
	if (consoleMessages.length > 0) {
		console.error(`browser messages:\n${consoleMessages.join("\n")}`);
	}
	if (output.length > 0) {
		console.error(`astro output:\n${output.join("")}`);
	}
	if (tractorOutput.length > 0) {
		console.error(`tractor output:\n${tractorOutput.join("")}`);
	}
	process.exitCode = 1;
} finally {
	if (tractor) await stopProcess(tractor);
	await stop();
	await rm(tempRoot, { recursive: true, force: true });
}

async function resolveTractorBinary(root) {
	if (process.env.REFARM_TRACTOR_BIN) return process.env.REFARM_TRACTOR_BIN;
	const config = await readFile(join(root, ".cargo/config.toml"), "utf8");
	const targetDir =
		config.match(/^\s*target-dir\s*=\s*"([^"]+)"/m)?.[1] ??
		join(root, "packages/tractor/target");
	return join(targetDir, "release/tractor");
}

async function reservePort() {
	const net = await import("node:net");
	return new Promise((resolvePort, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => resolvePort(port));
		});
	});
}

async function startTractor({ tractorPath, namespace, port, refarmHome, xdgDataHome }) {
	const child = spawn(
		tractorPath,
		[
			"--namespace",
			namespace,
			"--port",
			String(port),
			"--http-port",
			"0",
			"--log-level",
			"warn",
		],
		{
			cwd: workspaceRoot,
			env: tractorEnv(refarmHome, xdgDataHome),
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	child.stdout?.on("data", (chunk) => tractorOutput.push(chunk.toString()));
	child.stderr?.on("data", (chunk) => tractorOutput.push(chunk.toString()));
	child.once("exit", (code, signal) => {
		tractorOutput.push(`tractor exited code=${code} signal=${signal}\n`);
	});
	return child;
}

function tractorEnv(refarmHome, xdgDataHome) {
	return {
		...process.env,
		REFARM_HOME: refarmHome,
		XDG_DATA_HOME: xdgDataHome,
	};
}

async function waitForTractor(wsUrl, timeout) {
	const started = Date.now();
	let lastError = null;
	while (Date.now() - started < timeout) {
		try {
			await probeWebSocket(wsUrl);
			return;
		} catch (error) {
			lastError = error;
			await delay(150);
		}
	}
	throw new Error(`Timed out waiting for ${wsUrl}: ${lastError?.message ?? "unknown"}`);
}

function probeWebSocket(wsUrl) {
	return new Promise((resolveProbe, reject) => {
		const ws = new WebSocket(wsUrl);
		const timer = setTimeout(() => {
			ws.close();
			reject(new Error("websocket probe timeout"));
		}, 1_500);
		ws.binaryType = "arraybuffer";
		ws.addEventListener("message", () => {
			clearTimeout(timer);
			ws.close();
			resolveProbe();
		}, { once: true });
		ws.addEventListener("error", () => {
			clearTimeout(timer);
			reject(new Error("websocket probe error"));
		}, { once: true });
	});
}

async function waitForNodeInTractor({
	tractorPath,
	namespace,
	nodeId,
	nodeType,
	env,
	timeoutMs,
}) {
	const started = Date.now();
	let lastOutput = "";
	while (Date.now() - started < timeoutMs) {
		const result = await runTractorQuery({
			tractorPath,
			namespace,
			nodeType,
			env,
		});
		lastOutput = result.stdout || result.stderr;
		const nodes = parseJsonArray(result.stdout);
		if (
			nodes.some(
				(node) =>
					node?.id === nodeId ||
					node?.["@id"] === nodeId ||
					node?.nodeId === nodeId,
			)
		) {
			return;
		}
		await delay(250);
	}
	throw new Error(
		`Timed out waiting for ${nodeId} in Tractor namespace ${namespace}. Last query: ${lastOutput}`,
	);
}

function runTractorQuery({ tractorPath, namespace, nodeType, env }) {
	return new Promise((resolveQuery) => {
		const child = spawn(
			tractorPath,
			[
				"query",
				"--namespace",
				namespace,
				"--type",
				nodeType,
				"--format",
				"json",
				"--limit",
				"20",
			],
			{ cwd: workspaceRoot, env },
		);
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.once("exit", (code) => resolveQuery({ code, stdout, stderr }));
	});
}

function parseJsonArray(value) {
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function stopProcess(child) {
	if (child.exitCode !== null) return;
	child.kill("SIGTERM");
	const exited = await Promise.race([
		new Promise((resolveExit) => child.once("exit", resolveExit)),
		delay(2_000).then(() => "timeout"),
	]);
	if (exited === "timeout" && child.exitCode === null) child.kill("SIGKILL");
}

function delay(ms) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
