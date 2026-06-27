import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.REFARM_ME_SMOKE_PORT ?? "4327");
const appUrl = `http://127.0.0.1:${port}/`;
const syncSelector = "[data-refarm-me-sync-status]";
const timeoutMs = Number(process.env.REFARM_ME_SMOKE_TIMEOUT_MS ?? "15000");
const verbose = process.env.REFARM_ME_SMOKE_VERBOSE === "1";
const consoleMessages = [];

const server = spawn(
	"pnpm",
	["exec", "astro", "dev", "--host", "127.0.0.1", "--port", String(port)],
	{
		cwd: appRoot,
		env: { ...process.env, NO_COLOR: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	},
);

const serverOutput = [];
server.stdout?.on("data", (chunk) => serverOutput.push(chunk.toString()));
server.stderr?.on("data", (chunk) => serverOutput.push(chunk.toString()));

try {
	await waitForHttp(appUrl, timeoutMs);

	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		page.on("console", (message) =>
			consoleMessages.push(`${message.type()}: ${message.text()}`),
		);
		page.on("pageerror", (error) =>
			consoleMessages.push(`pageerror: ${error.message}`),
		);

		await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
		await page.locator(syncSelector).waitFor({ state: "visible", timeout: timeoutMs });
		await page.waitForFunction(
			(selector) =>
				document.querySelector(selector)?.textContent?.trim() ===
				"snapshot-applied",
			syncSelector,
			{ timeout: timeoutMs },
		);

		console.log(`ok: apps/me rendered snapshot-applied from ${appUrl}`);
		if (verbose && consoleMessages.length > 0) {
			console.log(`browser messages:\n${consoleMessages.join("\n")}`);
		}
	} finally {
		await browser.close();
	}
} catch (error) {
	console.error(error);
	if (consoleMessages.length > 0) {
		console.error(`browser messages:\n${consoleMessages.join("\n")}`);
	}
	if (serverOutput.length > 0) {
		console.error(`astro output:\n${serverOutput.join("")}`);
	}
	process.exitCode = 1;
} finally {
	await stopServer(server);
}

async function waitForHttp(url, timeout) {
	const started = Date.now();
	while (Date.now() - started < timeout) {
		if (server.exitCode !== null) {
			throw new Error(`Astro dev server exited with code ${server.exitCode}`);
		}
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// Retry until the server is ready or timeout is reached.
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`Timed out waiting for ${url}`);
}

async function stopServer(child) {
	if (child.exitCode !== null) return;
	child.kill("SIGTERM");
	const exit = once(child, "exit");
	const timeout = new Promise((resolve) => setTimeout(resolve, 2_000));
	await Promise.race([exit, timeout]);
	if (child.exitCode === null) child.kill("SIGKILL");
}
