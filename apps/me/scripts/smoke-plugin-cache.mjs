import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startAstroDevServer } from "./lib/astro-dev-server.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.REFARM_ME_CACHE_SMOKE_PORT ?? "4328");
const timeoutMs = Number(process.env.REFARM_ME_SMOKE_TIMEOUT_MS ?? "15000");
const verbose = process.env.REFARM_ME_SMOKE_VERBOSE === "1";
const { appUrl, output, stop, waitForHttp } = startAstroDevServer({
	appRoot,
	port,
});
const consoleMessages = [];

const wasmBytes = Buffer.from([
	0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
]);
const integrity = `sha256-${createHash("sha256").update(wasmBytes).digest("base64")}`;
const pluginId = "@refarm.me/cache-proof";
const wasmUrl = `${appUrl}__refarm-me-cache-proof.wasm`;
const manifest = {
	id: pluginId,
	name: "Refarm.me Cache Proof",
	version: "0.1.0",
	entry: wasmUrl,
	capabilities: { provides: [], requires: [] },
	permissions: [],
	targets: ["browser"],
	observability: { hooks: [] },
	certification: { license: "MIT", a11yLevel: 0, languages: ["en"] },
	integrity,
};

try {
	await waitForHttp(timeoutMs);

	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		let fetchCount = 0;
		page.on("console", (message) =>
			consoleMessages.push(`${message.type()}: ${message.text()}`),
		);
		page.on("pageerror", (error) =>
			consoleMessages.push(`pageerror: ${error.message}`),
		);
		await page.route(wasmUrl, async (route) => {
			fetchCount += 1;
			await route.fulfill({
				status: 200,
				contentType: "application/wasm",
				body: wasmBytes,
			});
		});

		await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
		await runCacheEvict(page, pluginId);
		const first = await runCacheProof(page, {
			manifest,
			wasmUrl,
			force: true,
		});
		await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
		const second = await runCacheProof(page, {
			manifest,
			wasmUrl,
			force: false,
		});

		if (!first.persisted || !second.persisted) {
			throw new Error(
				`Expected plugin bytes to be readable from cache: first=${JSON.stringify(first)} second=${JSON.stringify(second)}`,
			);
		}
		if (!second.cached || fetchCount !== 1) {
			throw new Error(
				`Expected reload install to hit OPFS cache without refetch: cached=${second.cached} fetchCount=${fetchCount}`,
			);
		}

		console.log(
			`ok: apps/me plugin cache survived reload at ${second.cachePath}`,
		);
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

async function runCacheProof(page, input) {
	return page.evaluate(async (proofInput) => {
		const cache = await import("/src/lib/me-plugin-cache.ts");
		return cache.proveRefarmMePluginCache(proofInput);
	}, input);
}

async function runCacheEvict(page, pluginId) {
	await page.evaluate(async (targetPluginId) => {
		const cache = await import("/src/lib/me-plugin-cache.ts");
		await cache.evictRefarmMePluginCache(targetPluginId);
	}, pluginId);
}
