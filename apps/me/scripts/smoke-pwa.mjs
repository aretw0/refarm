import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startAstroDevServer } from "./lib/astro-dev-server.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.REFARM_ME_PWA_SMOKE_PORT ?? "4330");
const timeoutMs = Number(process.env.REFARM_ME_SMOKE_TIMEOUT_MS ?? "15000");
const verbose = process.env.REFARM_ME_SMOKE_VERBOSE === "1";
const { appUrl, output, stop, waitForHttp } = startAstroDevServer({
	appRoot,
	port,
});
const consoleMessages = [];

try {
	await waitForHttp(timeoutMs);

	const browser = await chromium.launch({ headless: true });
	try {
		const context = await browser.newContext({
			baseURL: appUrl,
			serviceWorkers: "allow",
		});
		const page = await context.newPage();
		page.on("console", (message) =>
			consoleMessages.push(`${message.type()}: ${message.text()}`),
		);
		page.on("pageerror", (error) =>
			consoleMessages.push(`pageerror: ${error.message}`),
		);

		await page.goto(appUrl, {
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
		await page.waitForFunction(
			() => document.documentElement.dataset.refarmMePwa === "ready",
			undefined,
			{ timeout: timeoutMs },
		);
		await page.waitForFunction(
			() => navigator.serviceWorker.controller !== null,
			undefined,
			{ timeout: timeoutMs },
		);
		await page.reload({ waitUntil: "networkidle", timeout: timeoutMs });
		await page.waitForSelector("[data-refarm-me-surface]", {
			timeout: timeoutMs,
		});

		const manifest = await page.evaluate(async () => {
			const response = await fetch("/manifest.webmanifest");
			return {
				ok: response.ok,
				contentType: response.headers.get("content-type") ?? "",
				body: await response.json(),
			};
		});
		if (
			!manifest.ok ||
			manifest.body.name !== "Refarm.me" ||
			manifest.body.display !== "standalone"
		) {
			throw new Error(`Unexpected PWA manifest: ${JSON.stringify(manifest)}`);
		}

		await context.setOffline(true);
		await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
		await page.waitForSelector("[data-refarm-me-surface]", {
			timeout: timeoutMs,
		});

		console.log("ok: apps/me PWA manifest and offline shell confirmed");
		if (verbose && consoleMessages.length > 0) {
			console.log(`browser messages:\n${consoleMessages.join("\n")}`);
		}
		await context.close();
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
