import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	createProcessHandoffSpecFromRunner,
	runProcessHandoffSync,
} from "@refarm.dev/cli/process-handoff";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

import { startWebServeServer } from "./web-serve.js";

/** Run openssl through the app's sanctioned process seam (never raw child_process). */
function runOpenssl(args: string[]): number {
	try {
		return runProcessHandoffSync(createProcessHandoffSpecFromRunner("openssl", args), {
			capture: true,
		}).exitCode;
	} catch {
		return 1;
	}
}

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

	it("proxies /sync WebSocket upgrades to the daemon — one origin for the device", async () => {
		// A fake daemon: echoes every message back, path-agnostic like the real ones.
		const daemon = new WebSocketServer({ port: 0 });
		daemon.on("connection", (socket) => {
			socket.on("message", (data) => socket.send(data));
		});
		const daemonPort = (daemon.address() as AddressInfo).port;
		try {
			const started = await startWebServeServer(root, {
				port: 0,
				host: "127.0.0.1",
				syncTarget: { host: "127.0.0.1", port: daemonPort },
			});
			server = started.server;
			const port = started.url.split(":").pop();
			const client = new WebSocket(`ws://127.0.0.1:${port}/sync`);
			const echoed = await new Promise<string>((resolve, reject) => {
				client.on("open", () => client.send("olá fazenda"));
				client.on("message", (data) => resolve(String(data)));
				client.on("error", reject);
			});
			expect(echoed).toBe("olá fazenda");
			client.close();
		} finally {
			await new Promise<void>((resolve) => daemon.close(() => resolve()));
		}
	});

	it("destroys upgrade attempts outside /sync", async () => {
		const started = await startWebServeServer(root, { port: 0, host: "127.0.0.1" });
		server = started.server;
		const port = started.url.split(":").pop();
		const client = new WebSocket(`ws://127.0.0.1:${port}/other`);
		const outcome = await new Promise<string>((resolve) => {
			client.on("open", () => resolve("opened"));
			client.on("error", () => resolve("refused"));
		});
		expect(outcome).toBe("refused");
	});
});

const opensslAvailable = runOpenssl(["version"]) === 0;

describe.skipIf(!opensslAvailable)("refarm web serve — TLS (the secure-context door)", () => {
	it("serves https with an operator-supplied cert/key pair — verified against that very cert", async () => {
		const certDir = mkdtempSync(path.join(tmpdir(), "refarm-web-serve-tls-"));
		const keyFile = path.join(certDir, "key.pem");
		const certFile = path.join(certDir, "cert.pem");
		try {
			expect(
				runOpenssl([
					"req", "-x509", "-newkey", "rsa:2048", "-nodes",
					"-keyout", keyFile, "-out", certFile,
					"-days", "1", "-subj", "/CN=localhost",
					"-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
				]),
			).toBe(0);
			const started = await startWebServeServer(root, {
				port: 0,
				host: "127.0.0.1",
				tls: { certFile, keyFile },
			});
			server = started.server;
			expect(started.url).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
			// Full TLS verification, anchored on the fixture cert itself (its own CA) —
			// never rejectUnauthorized:false, even in tests.
			const response = await new Promise<{
				status: number;
				headers: Record<string, string | string[] | undefined>;
			}>((resolve, reject) => {
				const request = httpsGet(
					`${started.url}/`,
					{ ca: readFileSync(certFile) },
					(res) => {
						res.resume();
						resolve({ status: res.statusCode ?? 0, headers: res.headers });
					},
				);
				request.on("error", reject);
			});
			expect(response.status).toBe(200);
			expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
		} finally {
			rmSync(certDir, { recursive: true, force: true });
		}
	});
});
