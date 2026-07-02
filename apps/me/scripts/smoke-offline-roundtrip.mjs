import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startAstroDevServer } from "./lib/astro-dev-server.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.REFARM_ME_OFFLINE_SMOKE_PORT ?? "4331");
const syncSelector = "[data-refarm-me-sync-status]";
const timeoutMs = Number(process.env.REFARM_ME_SMOKE_TIMEOUT_MS ?? "18000");
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
		const page = await browser.newPage();
		page.on("console", (message) =>
			consoleMessages.push(`${message.type()}: ${message.text()}`),
		);
		page.on("pageerror", (error) =>
			consoleMessages.push(`pageerror: ${error.message}`),
		);
		await installRoundtripWebSocketMock(page);

		await page.goto(appUrl, {
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
		await page.waitForFunction(
			() => globalThis.__REFARM_ME_ROUNDTRIP__?.workbench,
			undefined,
			{ timeout: timeoutMs },
		);
		await page.locator(syncSelector).waitFor({
			state: "visible",
			timeout: timeoutMs,
		});
		await page.waitForFunction(
			() => globalThis.__REFARM_ME_ROUNDTRIP__?.sent.length >= 1,
			undefined,
			{ timeout: timeoutMs },
		);
		const initialSend = await latestSend(page);

		await page.evaluate(() => {
			globalThis.__REFARM_ME_ROUNDTRIP__.instances[0].serverClose();
		});
		await page.waitForFunction(
			(selector) =>
				document.querySelector(selector)?.textContent?.trim() ===
				"reconnecting",
			syncSelector,
			{ timeout: timeoutMs },
		);

		await page.evaluate(async () => {
			const workbench = globalThis.__REFARM_ME_ROUNDTRIP__.workbench;
			await workbench.storeLocalNode({
				id: "refarm-me-offline-roundtrip-proof",
				type: "refarm:OfflineRoundtripProof",
				context: "citizen",
				payload: JSON.stringify({ source: "smoke-offline-roundtrip" }),
				sourcePlugin: "apps/me:smoke",
			});
		});
		await page.waitForFunction(
			() =>
				globalThis.__REFARM_ME_ROUNDTRIP__?.instances.length >= 2 &&
				globalThis.__REFARM_ME_ROUNDTRIP__?.sent.length >= 2,
			undefined,
			{ timeout: timeoutMs },
		);
		const reconnectSend = await latestSend(page);
		if (
			reconnectSend.socketIndex <= initialSend.socketIndex ||
			reconnectSend.byteLength <= initialSend.byteLength
		) {
			throw new Error(
				`Expected reconnect to deliver a larger local update: initial=${JSON.stringify(initialSend)} reconnect=${JSON.stringify(reconnectSend)}`,
			);
		}
		await page.waitForFunction(
			(selector) =>
				document.querySelector(selector)?.textContent?.trim() === "connected",
			syncSelector,
			{ timeout: timeoutMs },
		);

		console.log(
			`ok: apps/me delivered offline mutation on reconnect (${initialSend.byteLength} -> ${reconnectSend.byteLength} bytes)`,
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

async function installRoundtripWebSocketMock(page) {
	await page.addInitScript(() => {
		const NativeWebSocket = globalThis.WebSocket;
		const state = {
			instances: [],
			sent: [],
			workbench: null,
		};
		class RefarmMeRoundtripWebSocket {
			static CONNECTING = 0;
			static OPEN = 1;
			static CLOSING = 2;
			static CLOSED = 3;

			binaryType = "blob";
			onclose = null;
			onerror = null;
			onmessage = null;
			onopen = null;
			readyState = RefarmMeRoundtripWebSocket.CONNECTING;
			sent = [];

			constructor(url, protocols) {
				if (String(url) !== "ws://localhost:42000") {
					return new NativeWebSocket(url, protocols);
				}
				this.url = String(url);
				state.instances.push(this);
				queueMicrotask(() => this.open());
			}

			open() {
				if (this.readyState !== RefarmMeRoundtripWebSocket.CONNECTING) return;
				this.readyState = RefarmMeRoundtripWebSocket.OPEN;
				this.onopen?.(new Event("open"));
			}

			send(data) {
				const bytes = Array.from(bytesFrom(data));
				const message = {
					socketIndex: state.instances.indexOf(this),
					byteLength: bytes.length,
					bytes,
				};
				this.sent.push(message);
				state.sent.push(message);
			}

			close() {
				this.serverClose();
			}

			serverClose() {
				if (this.readyState === RefarmMeRoundtripWebSocket.CLOSED) return;
				this.readyState = RefarmMeRoundtripWebSocket.CLOSED;
				this.onclose?.(new CloseEvent("close"));
			}
		}

		function bytesFrom(data) {
			if (data instanceof ArrayBuffer) return new Uint8Array(data);
			if (ArrayBuffer.isView(data)) {
				return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			}
			return new Uint8Array();
		}

		globalThis.__REFARM_ME_ROUNDTRIP__ = state;
		globalThis.__REFARM_ME_ON_WORKBENCH_READY__ = (workbench) => {
			state.workbench = workbench;
		};
		globalThis.WebSocket = RefarmMeRoundtripWebSocket;
	});
}

async function latestSend(page) {
	return page.evaluate(() => {
		const sent = globalThis.__REFARM_ME_ROUNDTRIP__.sent;
		return sent.at(-1);
	});
}
