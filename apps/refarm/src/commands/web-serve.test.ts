import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startWebServeServer } from "./web-serve.js";

let root: string;
let outside: string;
let server: Awaited<ReturnType<typeof startWebServeServer>>["server"] | undefined;

beforeEach(() => {
	outside = mkdtempSync(path.join(tmpdir(), "refarm-web-serve-outside-"));
	root = path.join(outside, "site");
	mkdirSync(path.join(root, "assets"), { recursive: true });
	writeFileSync(path.join(root, "index.html"), "<!doctype html><title>hub</title>");
	writeFileSync(path.join(root, "assets", "app.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d]));
	writeFileSync(path.join(root, "manifest.webmanifest"), "{}");
	writeFileSync(path.join(outside, "secret.txt"), "not served");
});

afterEach(async () => {
	if (server) {
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = undefined;
	}
	rmSync(outside, { recursive: true, force: true });
});

async function serve(): Promise<string> {
	const started = await startWebServeServer(root, { port: 0, host: "127.0.0.1" });
	server = started.server;
	return started.url.replace("http://127.0.0.1", "http://127.0.0.1");
}

describe("refarm web serve — the hub's static server", () => {
	it("serves index.html at / with the cross-origin-isolation headers", async () => {
		const base = await serve();
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		// The whole point: crossOriginIsolated must hold or the OPFS/WASM runtime won't boot.
		expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
		expect(res.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
		expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
		expect(await res.text()).toContain("hub");
	});

	it("serves wasm with the wasm content type", async () => {
		const base = await serve();
		const res = await fetch(`${base}/assets/app.wasm`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/wasm");
	});

	it("serves the PWA manifest with its manifest content type", async () => {
		const base = await serve();
		const res = await fetch(`${base}/manifest.webmanifest`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/manifest+json");
	});

	it("404s a missing file", async () => {
		const base = await serve();
		const res = await fetch(`${base}/nope.html`);
		expect(res.status).toBe(404);
	});

	it("refuses path traversal — the root is a containment boundary", async () => {
		const base = await serve();
		for (const attempt of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"]) {
			const res = await fetch(`${base}${attempt}`);
			expect(res.status, attempt).toBe(404);
		}
	});

	it("405s non-read methods", async () => {
		const base = await serve();
		const res = await fetch(`${base}/`, { method: "POST" });
		expect(res.status).toBe(405);
	});

	it("honors an explicit host bind — LAN exposure is an operator decision", async () => {
		const started = await startWebServeServer(root, { port: 0, host: "0.0.0.0" });
		server = started.server;
		expect(started.url).toMatch(/^http:\/\/0\.0\.0\.0:\d+$/);
		const port = started.url.split(":").pop();
		const res = await fetch(`http://127.0.0.1:${port}/`);
		expect(res.status).toBe(200);
	});
});
