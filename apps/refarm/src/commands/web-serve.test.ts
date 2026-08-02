import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { get as httpsGet } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	createProcessHandoffSpecFromRunner,
	runProcessHandoffSync,
} from "@refarm.dev/cli/process-handoff";
import { parseSurfaces, type SurfaceCatalog } from "@refarm.dev/std";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

import {
	createWebServeCommand,
	DEFAULT_WEB_SERVE_PORT,
	ifNoneMatchMatches,
	isSidecarApiPath,
	manifestETag,
	resolveTlsPort,
	startWebServeServer,
} from "./web-serve.js";

/** Every test injects the declaration rather than letting the server read the machine's real
 *  `.refarm/config.json` — the bind must be decided by data the test controls, and the
 *  operator's live config is not a fixture. */
const UNDECLARED: SurfaceCatalog = parseSurfaces({});
/** The operator's live shape: a device-token gate on the sidecar, `daemon-ws` loopback. It is
 *  what makes O6's upstream-gated precondition true without saying anything about `web`. */
const GATED_NODE_SHAPE = {
	"sidecar-http": { expose: "tailnet", gate: "device-token" },
	"daemon-ws": { expose: "loopback" },
};
const declaring = (web: Record<string, unknown>): SurfaceCatalog =>
	parseSurfaces({ surfaces: { ...GATED_NODE_SHAPE, web } });

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
	const started = await startWebServeServer(root, {
		port: 0,
		host: "127.0.0.1",
		surfaces: UNDECLARED,
	});
	server = started.server;
	return started.url;
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

	it("S1 — an UNDECLARED `web` binds loopback and refuses everything wider", async () => {
		// PURE: the guard throws before any server object exists, so no socket is opened.
		await expect(
			startWebServeServer(root, { port: 0, host: "0.0.0.0", surfaces: UNDECLARED }),
		).rejects.toThrow(/no `surfaces.web` declaration is present/);
		await expect(
			startWebServeServer(root, { port: 0, host: "100.64.0.1", surfaces: UNDECLARED }),
		).rejects.toThrow(/undeclared surface binds loopback only/);
	});

	it("O5 — an auth policy elsewhere on the machine no longer opens this listener", async () => {
		// THE MUTATION GUARD for the criterion this slice replaced. Under the old rule BOTH of
		// these bound: a policy file existed, so a listener that reads no `Authorization` header
		// — not once — was permitted to open itself to every device that can route here. The
		// question was never about this surface, and now it is.
		const policy = path.join(outside, "auth-policy.json");
		writeFileSync(policy, JSON.stringify({ credentials: [] }));
		process.env.REFARM_AUTH_POLICY = policy;
		try {
			await expect(
				startWebServeServer(root, { port: 0, host: "0.0.0.0", surfaces: UNDECLARED }),
			).rejects.toThrow(/no `surfaces.web` declaration is present/);
			// …and not even a node whose OTHER surface declares a real credential gate.
			await expect(
				startWebServeServer(root, {
					port: 0,
					host: "0.0.0.0",
					surfaces: parseSurfaces({ surfaces: GATED_NODE_SHAPE }),
				}),
			).rejects.toThrow(/undeclared surface binds loopback only/);
		} finally {
			delete process.env.REFARM_AUTH_POLICY;
		}
	});

	it("S3 — `web` may not declare a gate it cannot enforce; the refusal names the fix", () => {
		// Refused AT PARSE, exactly where the Rust daemon refuses it, so one config file means
		// one thing in both runtimes. `refarm web serve` verifies no bearer, so `device-token`
		// on this surface would claim an enforcement that does not exist.
		expect(() => declaring({ expose: "tailnet", gate: "device-token" })).toThrow(
			"surfaces['web'].gate \"device-token\": 'web' verifies no bearer credential at all, so " +
				"declaring that gate would claim an enforcement that does not exist. If 'web' is " +
				'deliberately open, say so — declare "gate": "none", which is admissible with ' +
				'"expose": "tailnet" or "loopback"',
		);
		// Loopback included — a lie is a lie wherever it binds.
		expect(() => declaring({ expose: "loopback", gate: "device-token" })).toThrow(
			/verifies no bearer credential at all/,
		);
	});

	it("S5 — a declared tailnet expose binds the resolved address, and a flag may only narrow it", async () => {
		const surfaces = declaring({ expose: "tailnet", gate: "none" });
		// A flag pointing somewhere wider than the declaration is refused…
		await expect(
			startWebServeServer(root, {
				port: 0,
				host: "0.0.0.0",
				surfaces,
				resolveTailnet: () => ({ ok: true, ipv4: "127.0.0.1" }),
			}),
		).rejects.toThrow(/never point somewhere else or wider/);
		// …and narrowing to loopback is always allowed, so the listener really does serve.
		const started = await startWebServeServer(root, {
			port: 0,
			host: "127.0.0.1",
			surfaces,
			resolveTailnet: () => ({ ok: true, ipv4: "100.64.7.7" }),
		});
		server = started.server;
		expect((await fetch(`${started.url}/`)).status).toBe(200);
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
				surfaces: UNDECLARED,
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
		const started = await startWebServeServer(root, {
			port: 0,
			host: "127.0.0.1",
			surfaces: UNDECLARED,
		});
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

describe("refarm web serve — T5, the migration that does not break a bootstrapped device", () => {
	it("defaults the https listener to the port beside the plain one", () => {
		expect(resolveTlsPort({ port: 4321 })).toBe(4322);
		expect(resolveTlsPort({ port: 4321, tlsPort: 8443 })).toBe(8443);
		expect(resolveTlsPort({ port: DEFAULT_WEB_SERVE_PORT })).toBe(DEFAULT_WEB_SERVE_PORT + 1);
	});

	it("refuses to take the plain listener's port for https, and says why", () => {
		expect(() => resolveTlsPort({ port: 4321, tlsPort: 4321 })).toThrow(/farm-update/);
		expect(() => resolveTlsPort({ port: 4321, tlsPort: 4321 })).toThrow(/literal `http:\/\//);
	});

	it("the refusal happens before anything is bound — no listener is left behind", async () => {
		await expect(
			startWebServeServer(root, {
				port: 43911,
				tlsPort: 43911,
				host: "127.0.0.1",
				surfaces: UNDECLARED,
				tls: { certFile: "/nonexistent.crt", keyFile: "/nonexistent.key" },
			}),
		).rejects.toThrow(/--tls-port 43911 is the same as --port 43911/);
		// If a server HAD been created, this bind would fail with EADDRINUSE.
		const probe = await startWebServeServer(root, {
			port: 43911,
			host: "127.0.0.1",
			surfaces: UNDECLARED,
		});
		server = probe.server;
		expect(probe.url).toBe("http://127.0.0.1:43911");
	});
});

describe.skipIf(!opensslAvailable)("refarm web serve — TLS (the secure-context door)", () => {
	let certDir: string;
	let keyFile: string;
	let certFile: string;
	let tlsServer: import("node:http").Server | undefined;

	beforeEach(() => {
		certDir = mkdtempSync(path.join(tmpdir(), "refarm-web-serve-tls-"));
		keyFile = path.join(certDir, "key.pem");
		certFile = path.join(certDir, "cert.pem");
		expect(
			runOpenssl([
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-keyout",
				keyFile,
				"-out",
				certFile,
				"-days",
				"1",
				"-subj",
				"/CN=localhost",
				"-addext",
				"subjectAltName=IP:127.0.0.1,DNS:localhost",
			]),
		).toBe(0);
	});

	afterEach(async () => {
		if (tlsServer) {
			await new Promise<void>((resolve) => tlsServer?.close(() => resolve()));
			tlsServer = undefined;
		}
		rmSync(certDir, { recursive: true, force: true });
	});

	async function getOverTls(url: string): Promise<{
		status: number;
		headers: Record<string, string | string[] | undefined>;
	}> {
		// Full TLS verification, anchored on the fixture cert itself (its own CA) —
		// never rejectUnauthorized:false, even in tests.
		return new Promise((resolve, reject) => {
			const request = httpsGet(url, { ca: readFileSync(certFile) }, (res) => {
				res.resume();
				resolve({ status: res.statusCode ?? 0, headers: res.headers });
			});
			request.on("error", reject);
		});
	}

	it("serves https with an operator-supplied cert/key pair — verified against that very cert", async () => {
		const started = await startWebServeServer(root, {
			port: 0,
			tlsPort: 0,
			host: "127.0.0.1",
			surfaces: UNDECLARED,
			tls: { certFile, keyFile },
		});
		server = started.server;
		tlsServer = started.tls?.server;
		expect(started.tls?.url).toMatch(/^https:\/\/127\.0\.0\.1:\d+$/);
		const response = await getOverTls(`${started.tls?.url}/`);
		expect(response.status).toBe(200);
		expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
	});

	it("THE KIT'S HTTP PATH IS UNAFFECTED — the plain listener stays up, on its own port", async () => {
		writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ files: [] }));
		const started = await startWebServeServer(root, {
			port: 0,
			tlsPort: 0,
			host: "127.0.0.1",
			surfaces: UNDECLARED,
			tls: { certFile, keyFile },
		});
		server = started.server;
		tlsServer = started.tls?.server;

		// `url` is ALWAYS the plain origin: it is what `farm-update` builds with a literal
		// `http://`, and it must not move when TLS is added.
		expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(started.tls?.url).not.toBe(started.url);

		// The very fetch the kit performs on every run, over plain http, with its ETag policy intact.
		const manifest = await fetch(`${started.url}/manifest.json`);
		expect(manifest.status).toBe(200);
		const etag = manifest.headers.get("etag");
		expect(etag).toBeTruthy();
		const revalidated = await fetch(`${started.url}/manifest.json`, {
			headers: { "if-none-match": etag as string },
		});
		expect(revalidated.status).toBe(304);
	});

	it("both listeners serve the SAME surface — one handler, two doors", async () => {
		const started = await startWebServeServer(root, {
			port: 0,
			tlsPort: 0,
			host: "127.0.0.1",
			surfaces: UNDECLARED,
			tls: { certFile, keyFile },
		});
		server = started.server;
		tlsServer = started.tls?.server;
		const overHttp = await fetch(`${started.url}/`);
		const overTls = await getOverTls(`${started.tls?.url}/`);
		expect(overHttp.status).toBe(200);
		expect(overTls.status).toBe(200);
		expect(await overHttp.text()).toContain("hub");
	});

	it("without TLS there is exactly one listener, and it is the plain one", async () => {
		const started = await startWebServeServer(root, {
			port: 0,
			host: "127.0.0.1",
			surfaces: UNDECLARED,
		});
		server = started.server;
		expect(started.tls).toBeUndefined();
		expect(started.url).toMatch(/^http:\/\//);
	});
});

describe("refarm web serve — the sidecar API proxy", () => {
	it("isSidecarApiPath matches the sidecar API, not static assets", () => {
		expect(isSidecarApiPath("/efforts")).toBe(true);
		expect(isSidecarApiPath("/efforts/abc")).toBe(true);
		expect(isSidecarApiPath("/sessions/1/history")).toBe(true);
		expect(isSidecarApiPath("/nodes")).toBe(true);
		expect(isSidecarApiPath("/operations")).toBe(true);
		expect(isSidecarApiPath("/operations/r-one")).toBe(true);
		expect(isSidecarApiPath("/")).toBe(false);
		expect(isSidecarApiPath("/manifest.webmanifest")).toBe(false);
		expect(isSidecarApiPath("/assets/app.wasm")).toBe(false);
		expect(isSidecarApiPath("/effortsxyz")).toBe(false); // a prefix must be a whole segment
	});

	it("proxies POST /efforts to the daemon sidecar (so the hub works over any origin)", async () => {
		const fake = createHttpServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				res.statusCode = 201;
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify({ method: req.method, path: req.url, body }));
			});
		});
		await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", () => resolve()));
		const fakePort = (fake.address() as AddressInfo).port;
		const started = await startWebServeServer(root, {
			port: 0,
			host: "127.0.0.1",
			surfaces: UNDECLARED,
			sidecarTarget: { host: "127.0.0.1", port: fakePort },
		});
		server = started.server;
		try {
			const res = await fetch(`${started.url}/efforts`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ hi: 1 }),
			});
			// 201 from the fake sidecar — NOT the 405 the static-only server would give.
			expect(res.status).toBe(201);
			const echoed = (await res.json()) as { method: string; path: string; body: string };
			expect(echoed.method).toBe("POST");
			expect(echoed.path).toBe("/efforts");
			expect(JSON.parse(echoed.body)).toEqual({ hi: 1 });
		} finally {
			await new Promise<void>((resolve) => fake.close(() => resolve()));
		}
	});
});

/**
 * O6 — one listener, several routes: declaring it open opens all of them.
 *
 * The artifact routes are read-only and open by declaration. The proxy routes are NOT open:
 * they inherit their upstream's gate, and the design is explicit that this inheritance "must be
 * demonstrated by test, not asserted". So each proxy route is driven with the SAME three probes
 * that were run by hand against the sidecar — no credential, wrong credential, valid credential
 * — through the proxy rather than at the upstream. The upstream is a STUB that enforces the way
 * the real one does; nothing here depends on a live daemon.
 *
 * A proxy route whose upstream has no gate may not be served on an open surface at all — that
 * is the precondition `resolveWebBindHost` enforces at bind time (see web-surface.test.ts).
 */
const VALID_TOKEN = "device-token-abc123";

/** A stub of the sidecar's `auth_middleware`: a bearer credential on EVERY request, or 401. */
function gatedSidecarStub(): ReturnType<typeof createHttpServer> {
	return createHttpServer((req, res) => {
		req.resume();
		const authorization = req.headers.authorization;
		if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
			res.statusCode = 401;
			return res.end("missing credential");
		}
		if (authorization.slice("Bearer ".length) !== VALID_TOKEN) {
			res.statusCode = 401;
			return res.end("invalid credential");
		}
		res.statusCode = 200;
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ ok: true }));
	});
}

/** A stub of ADR-093's WS handshake gate: the credential rides `Sec-WebSocket-Protocol` as
 *  `bearer.<token>` (a browser cannot set `Authorization` on a WebSocket), and only the
 *  protocol NAME is ever echoed back — never the token half. */
function gatedDaemonWsStub(): {
	server: ReturnType<typeof createHttpServer>;
	close: () => Promise<void>;
} {
	const wss = new WebSocketServer({ noServer: true, handleProtocols: () => "refarm-sync-v1" });
	wss.on("connection", (socket) => socket.on("message", (data) => socket.send(data)));
	const http = createHttpServer((_req, res) => {
		res.statusCode = 426;
		res.end();
	});
	http.on("upgrade", (req, socket, head) => {
		const offered = String(req.headers["sec-websocket-protocol"] ?? "")
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
		const token = offered
			.filter((entry) => entry.startsWith("bearer."))
			.map((entry) => entry.slice("bearer.".length))
			.find((value) => value.length > 0);
		if (token !== VALID_TOKEN) {
			const reason = token === undefined ? "missing credential" : "invalid credential";
			socket.write(`HTTP/1.1 401 Unauthorized\r\nx-refarm-reason: ${reason}\r\n\r\n`);
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket as never, head, (client) => wss.emit("connection", client, req));
	});
	return {
		server: http,
		close: () =>
			new Promise<void>((resolve) => {
				wss.close();
				http.close(() => resolve());
			}),
	};
}

/** Attempt the `/sync` handshake THROUGH the proxy and report what the upstream decided. */
function probeSyncProxy(base: string, protocols?: string[]): Promise<"accepted" | "refused"> {
	const url = `${base.replace("http://", "ws://")}/sync`;
	const client = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
	return new Promise((resolve) => {
		client.on("open", () => {
			client.close();
			resolve("accepted");
		});
		client.on("error", () => resolve("refused"));
	});
}

describe("O6 — proxy routes inherit their upstream's gate (demonstrated, not asserted)", () => {
	it("the sidecar API proxy: no credential ⇒ refused, wrong ⇒ refused, valid ⇒ accepted", async () => {
		const upstream = gatedSidecarStub();
		await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
		const upstreamPort = (upstream.address() as AddressInfo).port;
		const started = await startWebServeServer(root, {
			port: 0,
			host: "127.0.0.1",
			surfaces: UNDECLARED,
			sidecarTarget: { host: "127.0.0.1", port: upstreamPort },
		});
		server = started.server;
		try {
			// Driven THROUGH the proxy route, never at the upstream directly — that is the whole
			// point: the question is whether proxying loses the credential, not whether the
			// sidecar checks one.
			expect((await fetch(`${started.url}/efforts`, { method: "POST" })).status).toBe(401);
			expect(
				(
					await fetch(`${started.url}/efforts`, {
						method: "POST",
						headers: { authorization: "Bearer wrong-token" },
					})
				).status,
			).toBe(401);
			const accepted = await fetch(`${started.url}/efforts`, {
				method: "POST",
				headers: { authorization: `Bearer ${VALID_TOKEN}` },
			});
			expect(accepted.status).toBe(200);
			expect(await accepted.json()).toEqual({ ok: true });
		} finally {
			await new Promise<void>((resolve) => upstream.close(() => resolve()));
		}
	});

	it("the /sync WS proxy: no credential ⇒ refused, wrong ⇒ refused, valid ⇒ accepted", async () => {
		const upstream = gatedDaemonWsStub();
		await new Promise<void>((resolve) => upstream.server.listen(0, "127.0.0.1", () => resolve()));
		const upstreamPort = (upstream.server.address() as AddressInfo).port;
		const started = await startWebServeServer(root, {
			port: 0,
			host: "127.0.0.1",
			surfaces: UNDECLARED,
			syncTarget: { host: "127.0.0.1", port: upstreamPort },
		});
		server = started.server;
		try {
			expect(await probeSyncProxy(started.url)).toBe("refused");
			expect(await probeSyncProxy(started.url, ["refarm-sync-v1", "bearer.wrong-token"])).toBe(
				"refused",
			);
			expect(await probeSyncProxy(started.url, ["refarm-sync-v1", `bearer.${VALID_TOKEN}`])).toBe(
				"accepted",
			);
		} finally {
			await upstream.close();
		}
	});
});

describe("the manifest's traffic policy — ETag + If-None-Match (first slice)", () => {
	const MANIFEST = JSON.stringify({ name: "farm-client", version: "1", files: [] });

	beforeEach(() => {
		writeFileSync(path.join(root, "manifest.json"), MANIFEST);
	});

	it("serves manifest.json with a STRONG ETag derived from its bytes", async () => {
		const base = await serve();
		const res = await fetch(`${base}/manifest.json`);
		expect(res.status).toBe(200);
		const etag = res.headers.get("etag");
		expect(etag).toBe(manifestETag(MANIFEST));
		// Strong: quoted, no `W/` prefix — a match really does mean byte-identical content.
		expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
		expect(await res.text()).toBe(MANIFEST);
	});

	it("answers 304 to a matching If-None-Match, with no body", async () => {
		const base = await serve();
		const first = await fetch(`${base}/manifest.json`);
		const etag = first.headers.get("etag") ?? "";
		await first.text();
		const second = await fetch(`${base}/manifest.json`, { headers: { "if-none-match": etag } });
		expect(second.status).toBe(304);
		expect(second.headers.get("etag")).toBe(etag);
		expect(await second.text()).toBe("");
	});

	it("answers 200 to a STALE If-None-Match — the 304 is conditional, not sticky", async () => {
		const base = await serve();
		const stale = await fetch(`${base}/manifest.json`, {
			headers: {
				"if-none-match": '"0000000000000000000000000000000000000000000000000000000000000000"',
			},
		});
		expect(stale.status).toBe(200);
		expect(await stale.text()).toBe(MANIFEST);
	});

	it("a changed manifest changes the validator — the 304 cannot outlive its content", async () => {
		const base = await serve();
		const before = (await fetch(`${base}/manifest.json`)).headers.get("etag");
		writeFileSync(
			path.join(root, "manifest.json"),
			JSON.stringify({ name: "farm-client", version: "2", files: [] }),
		);
		const after = await fetch(`${base}/manifest.json`, {
			headers: { "if-none-match": before ?? "" },
		});
		expect(after.status).toBe(200);
		expect(after.headers.get("etag")).not.toBe(before);
	});

	it("keeps the policy to the manifest — other files carry no validator (T3: no DSL yet)", async () => {
		const base = await serve();
		expect((await fetch(`${base}/index.html`)).headers.get("etag")).toBeNull();
		expect((await fetch(`${base}/manifest.webmanifest`)).headers.get("etag")).toBeNull();
	});

	it("ifNoneMatchMatches reads a list, the wildcard, and a weakened offer", () => {
		const etag = '"abc"';
		expect(ifNoneMatchMatches(undefined, etag)).toBe(false);
		expect(ifNoneMatchMatches("", etag)).toBe(false);
		expect(ifNoneMatchMatches('"abc"', etag)).toBe(true);
		expect(ifNoneMatchMatches('"zzz", "abc"', etag)).toBe(true);
		expect(ifNoneMatchMatches('W/"abc"', etag)).toBe(true);
		expect(ifNoneMatchMatches("*", etag)).toBe(true);
		expect(ifNoneMatchMatches('"zzz"', etag)).toBe(false);
	});
});

describe("the `refarm web serve` --host flag carries NO default (the defaulted-flag defect)", () => {
	it("declares `--host` with no default value at all", () => {
		// THE defect that made `surfaces` inert for the sidecar for weeks. Under S5 a flag may
		// only NARROW the declaration, so a `--host` that ALWAYS carries `127.0.0.1` ALWAYS
		// narrows: `surfaces.web` could never take effect, and nothing would say so — inert AND
		// silent. Give the option a default again and this fails.
		const host = createWebServeCommand().options.find((option) => option.long === "--host");
		expect(host).toBeDefined();
		expect(host?.defaultValue).toBeUndefined();
	});

	it("the absence survives the action — the DECLARATION decides when no flag was passed", async () => {
		// A commander default is not the only way to lose the absence: `options.host ?? "127.0.0.1"`
		// inside the action would do it just as silently.
		const root = mkdtempSync(path.join(tmpdir(), "refarm-web-serve-default-"));
		try {
			const started = await startWebServeServer(root, {
				port: 0,
				surfaces: parseSurfaces({ surfaces: { web: { expose: "loopback" } } }),
			});
			try {
				expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
			} finally {
				await new Promise<void>((resolve) => started.server.close(() => resolve()));
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
