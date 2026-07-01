import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startAstroDevServer } from "./lib/astro-dev-server.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.REFARM_ME_CONTENT_SMOKE_PORT ?? "4329");
const timeoutMs = Number(process.env.REFARM_ME_SMOKE_TIMEOUT_MS ?? "15000");
const verbose = process.env.REFARM_ME_SMOKE_VERBOSE === "1";
const { appUrl, output, stop, waitForHttp } = startAstroDevServer({
	appRoot,
	port,
});
const consoleMessages = [];

const componentBytes = Buffer.from([
	0x00, 0x61, 0x73, 0x6d, 0x0a, 0x00, 0x01, 0x00,
]);
const runtimeModuleSource = `
export async function setup() {}
export async function renderHomesteadSurface(request) {
  const hostId = request.host?.hostId ?? "apps/me";
  return {
    html: '<section data-refarm-me-installed-content-plugin><p>Installed content plugin</p><small>' + hostId + '</small></section>'
  };
}
`;
const componentIntegrity = integrityFor(componentBytes);
const runtimeModuleIntegrity = integrityFor(Buffer.from(runtimeModuleSource));
const pluginId = "@refarm.me/content-proof";
const wasmUrl = `${appUrl}__refarm-me-content-plugin.component.wasm`;
const runtimeModuleUrl = `${appUrl}__refarm-me-content-plugin.browser.mjs`;
const manifest = {
	id: pluginId,
	name: "Refarm.me Content Proof",
	version: "0.1.0",
	entry: wasmUrl,
	integrity: componentIntegrity,
	capabilities: { provides: [], requires: [] },
	permissions: [],
	observability: {
		hooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
	},
	targets: ["browser"],
	certification: { license: "MIT", a11yLevel: 0, languages: ["en"] },
	extensions: {
		surfaces: [
			{
				layer: "homestead",
				kind: "panel",
				id: "installed-content-panel",
				slot: "main",
				capabilities: ["ui:panel:render"],
			},
		],
	},
};

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
		await page.route(wasmUrl, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/wasm",
				body: componentBytes,
			});
		});
		await page.route(runtimeModuleUrl, async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "text/javascript",
				body: runtimeModuleSource,
			});
		});
		await page.addInitScript((bootstrapInput) => {
			globalThis.__REFARM_ME_BOOTSTRAP_CONTENT_PLUGINS__ = [
				bootstrapInput,
			];
		}, {
			manifest,
			wasmUrl,
			browserRuntimeModule: {
				url: runtimeModuleUrl,
				integrity: runtimeModuleIntegrity,
			},
			force: true,
		});

		await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
		const content = page.locator("[data-refarm-me-installed-content-plugin]");
		await content.waitFor({ state: "visible", timeout: timeoutMs });
		await content.getByText("Installed content plugin").waitFor({
			state: "visible",
			timeout: timeoutMs,
		});

		console.log(`ok: apps/me rendered installed content plugin from ${wasmUrl}`);
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

function integrityFor(buffer) {
	return `sha256-${createHash("sha256").update(buffer).digest("base64")}`;
}
