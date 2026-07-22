/**
 * smoke-remote-device — the automated twin of "open the hub from your phone".
 *
 * Serves the BUILT hub over https on the host's real LAN address (loopback is a
 * secure context by definition, so only a non-loopback origin proves the TLS
 * wall), boots a real daemon, and drives a real Chromium at the LAN origin:
 *
 *   https://<lan-ip>:<port>  →  isSecureContext + crossOriginIsolated
 *                            →  OPFS/WASM workbench boots
 *                            →  sync DERIVES wss://<origin>/sync (no injection!)
 *                               and reaches the daemon through the proxy
 *                            →  the service worker registers
 *
 * The cert is a throwaway minted per run; Chromium trusts it by SPKI pin —
 * never a blanket ignore. Skips (exit 0, loud notice) when the machine has no
 * LAN address or no openssl.
 */
import { spawn } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { tractorBinaryPath } from "../../../scripts/lib/cargo-target.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appRoot, "../..");
const distDir = join(appRoot, "dist");
const refarmCli = join(workspaceRoot, "apps", "refarm", "dist", "index.js");
const timeoutMs = Number(process.env.REFARM_ME_SMOKE_TIMEOUT_MS ?? "45000");
const namespace = `refarm-me-remote-device-${process.pid}-${Date.now()}`;
const consoleMessages = [];
const children = [];

function lanAddress() {
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family === "IPv4" && !entry.internal) return entry.address;
		}
	}
	return null;
}

function run(command, args, options = {}) {
	const child = spawn(command, args, {
		cwd: workspaceRoot,
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});
	children.push(child);
	return child;
}

function runToCompletion(command, args, options = {}) {
	return new Promise((resolveRun, rejectRun) => {
		const child = run(command, args, options);
		let stderr = "";
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.once("exit", (code) =>
			code === 0
				? resolveRun()
				: rejectRun(new Error(`${command} exited ${code}: ${stderr.trim()}`)),
		);
	});
}

async function stopProcess(child) {
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	await new Promise((resolveStop) => child.once("exit", resolveStop));
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

function delay(ms) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitFor(probe, what) {
	const started = Date.now();
	let lastError = null;
	while (Date.now() - started < timeoutMs) {
		try {
			if (await probe()) return;
		} catch (error) {
			lastError = error;
		}
		await delay(200);
	}
	throw new Error(`Timed out waiting for ${what}: ${lastError?.message ?? "condition false"}`);
}

const ip = lanAddress();
if (!ip) {
	console.log("skip: no non-loopback IPv4 — the remote-device proof needs a LAN address");
	process.exit(0);
}
if (!existsSync(distDir)) {
	console.error(`apps/me/dist missing — run: pnpm --filter @refarm.me/app run build`);
	process.exit(1);
}
if (!existsSync(refarmCli)) {
	console.error(`refarm CLI dist missing — run: pnpm -C apps/refarm run build`);
	process.exit(1);
}

const tempRoot = await mkdtemp(join(tmpdir(), "refarm-me-remote-device-"));
const certFile = join(tempRoot, "cert.pem");
const keyFile = join(tempRoot, "key.pem");
let browser = null;
let serve = null;
let tractor = null;

try {
	try {
		await runToCompletion("openssl", [
			"req", "-x509", "-newkey", "rsa:2048", "-nodes",
			"-keyout", keyFile, "-out", certFile,
			"-days", "1", "-subj", "/CN=refarm-remote-device",
			"-addext", `subjectAltName=IP:${ip},IP:127.0.0.1`,
		]);
	} catch {
		console.log("skip: openssl unavailable — cannot mint the throwaway cert");
		process.exit(0);
	}

	// Chromium trusts exactly THIS key, nothing else: pin by SPKI sha256.
	const spki = new X509Certificate(readFileSync(certFile))
		.publicKey.export({ type: "spki", format: "der" });
	const spkiPin = createHash("sha256").update(spki).digest("base64");

	const tractorPort = await reservePort();
	const hubPort = await reservePort();
	const tractorPath = process.env.REFARM_TRACTOR_BIN ?? tractorBinaryPath(workspaceRoot);
	tractor = run(tractorPath, [
		"--namespace", namespace,
		"--port", String(tractorPort),
		"--http-port", "0",
		"--log-level", "warn",
		"--refarm-dir", join(tempRoot, ".refarm"),
	]);
	serve = run(process.execPath, [
		refarmCli, "web", "serve", distDir,
		"--host", "0.0.0.0",
		"--port", String(hubPort),
		"--tls-cert", certFile,
		"--tls-key", keyFile,
		"--sync-target", `127.0.0.1:${tractorPort}`,
		"--json",
	]);
	await waitFor(async () => {
		const res = await fetch(`https://127.0.0.1:${hubPort}/`, {
			// Node's fetch has no SPKI pinning; trust the fixture CA directly.
			dispatcher: undefined,
		}).catch(() => null);
		return res !== null && res.ok;
	}, "hub https origin").catch(async () => {
		// Node fetch refuses the self-signed cert — probe via TLS socket instead.
		const tls = await import("node:tls");
		await waitFor(
			() =>
				new Promise((resolveProbe) => {
					const socket = tls.connect(
						{ host: "127.0.0.1", port: hubPort, ca: readFileSync(certFile) },
						() => {
							socket.end();
							resolveProbe(true);
						},
					);
					socket.on("error", () => resolveProbe(false));
				}),
			"hub tls socket",
		);
	});

	browser = await chromium.launch({
		headless: true,
		args: [`--ignore-certificate-errors-spki-list=${spkiPin}`],
	});
	const page = await browser.newPage();
	page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
	page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
	await page.addInitScript(() => {
		globalThis.__REFARM_ME_REMOTE__ = { workbench: null };
		globalThis.__REFARM_ME_ON_WORKBENCH_READY__ = (workbench) => {
			globalThis.__REFARM_ME_REMOTE__.workbench = workbench;
		};
	});

	const origin = `https://${ip}:${hubPort}`;
	await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: timeoutMs });

	const context = await page.evaluate(() => ({
		secure: globalThis.isSecureContext === true,
		isolated: globalThis.crossOriginIsolated === true,
	}));
	if (!context.secure) throw new Error("origin is not a secure context");
	if (!context.isolated) throw new Error("origin is not cross-origin isolated");

	await page.waitForFunction(() => globalThis.__REFARM_ME_REMOTE__?.workbench, undefined, {
		timeout: timeoutMs,
	});

	// The pact under test: NO sync URL was injected — the page must have DERIVED
	// wss://<origin>/sync and reached the daemon through the serve proxy.
	await page.waitForFunction(
		() => {
			const status = document
				.querySelector("[data-refarm-me-sync-status]")
				?.textContent?.trim();
			return status === "connected" || status === "snapshot-applied";
		},
		undefined,
		{ timeout: timeoutMs },
	);

	await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true), undefined, {
		timeout: timeoutMs,
	});

	console.log(
		`ok: remote-device roundtrip — https://${ip} secure+isolated, workbench booted, ` +
			"sync derived wss://<origin>/sync through the proxy, service worker registered",
	);
} catch (error) {
	console.error(`remote-device smoke failed: ${error.message}`);
	for (const line of consoleMessages.slice(-20)) console.error(`  ${line}`);
	process.exitCode = 1;
} finally {
	if (browser) await browser.close().catch(() => {});
	await stopProcess(serve);
	await stopProcess(tractor);
	await rm(tempRoot, { recursive: true, force: true });
}
