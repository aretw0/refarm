import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startAstroDevServer } from "./lib/astro-dev-server.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.REFARM_ME_SMOKE_PORT ?? "4327");
const syncSelector = "[data-refarm-me-sync-status]";
const timeoutMs = Number(process.env.REFARM_ME_SMOKE_TIMEOUT_MS ?? "15000");
const verbose = process.env.REFARM_ME_SMOKE_VERBOSE === "1";
const consoleMessages = [];
const { appUrl, output, stop, waitForHttp } = startAstroDevServer({
	appRoot,
	port,
});

try {
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
	if (output.length > 0) {
		console.error(`astro output:\n${output.join("")}`);
	}
	process.exitCode = 1;
} finally {
	await stop();
}
