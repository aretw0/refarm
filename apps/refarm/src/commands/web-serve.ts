import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import {
	createServer,
	request as httpRequest,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createServer as createTlsServer } from "node:https";
import { connect, type Socket } from "node:net";
import path from "node:path";

import { Command } from "commander";

/**
 * `refarm web serve <dir>` — the missing hub-serve command (outward horizon).
 *
 * A hardened static server for a built hub (`apps/me/dist` and kin), sending the
 * cross-origin-isolation headers on every response — without COOP/COEP the
 * browser refuses `crossOriginIsolated`, and the hub's OPFS-SQLite/WASM runtime
 * cannot boot off-localhost. Loopback by default; `--host 0.0.0.0` exposes the
 * hub to the operator's other devices, the same posture as `serve` and the
 * daemon's `--http-host`. Serving is read-only: GET/HEAD, root-contained paths.
 */

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".map": "application/json",
	".wasm": "application/wasm",
	".webmanifest": "application/manifest+json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
	".woff2": "font/woff2",
};

function writeIsolationHeaders(res: ServerResponse): void {
	res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
	res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
	res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

/** Resolve a request path inside the root, or null when it escapes it. */
function containedPath(root: string, pathname: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	const resolved = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
	if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
	return resolved;
}

/** Sidecar HTTP API paths the hub calls same-origin (POST /efforts, GET
 * /efforts/:id, …). web serve proxies them to the daemon's sidecar so the hub
 * works over ANY origin it was served from — a tunnel included — the same way
 * /sync (the CRDT WebSocket) is proxied. Without this a same-origin POST /efforts
 * hits the static server and 405s (which broke the phone chat over a tunnel). */
const SIDECAR_API_PREFIXES = ["/efforts", "/sessions", "/nodes", "/tasks", "/plugins"] as const;

export function isSidecarApiPath(pathname: string): boolean {
	return SIDECAR_API_PREFIXES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

function proxyToSidecar(
	target: WebServeSyncTarget,
	req: IncomingMessage,
	res: ServerResponse,
): void {
	const upstream = httpRequest(
		{
			host: target.host,
			port: target.port,
			method: req.method,
			path: req.url,
			headers: { ...req.headers, host: `${target.host}:${target.port}` },
		},
		(upstreamRes) => {
			res.statusCode = upstreamRes.statusCode ?? 502;
			for (const [name, value] of Object.entries(upstreamRes.headers)) {
				if (value !== undefined) res.setHeader(name, value);
			}
			upstreamRes.pipe(res);
		},
	);
	upstream.on("error", () => {
		if (!res.headersSent) res.statusCode = 502;
		res.end();
	});
	req.pipe(upstream);
}

export function createWebServeHandler(
	rootDir: string,
	sidecarTarget?: WebServeSyncTarget,
): (req: IncomingMessage, res: ServerResponse) => void {
	const root = path.resolve(rootDir);
	return (req, res) => {
		void (async () => {
			const url = new URL(req.url ?? "/", "http://localhost");
			// Sidecar API → proxy to the daemon; everything else is served static.
			if (sidecarTarget && isSidecarApiPath(url.pathname)) {
				proxyToSidecar(sidecarTarget, req, res);
				return;
			}
			writeIsolationHeaders(res);
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.statusCode = 405;
				res.setHeader("Allow", "GET, HEAD");
				return res.end();
			}
			const contained = containedPath(root, url.pathname);
			if (!contained) {
				res.statusCode = 404;
				return res.end();
			}
			let filePath = contained;
			try {
				let stats = await stat(filePath);
				if (stats.isDirectory()) {
					filePath = path.join(filePath, "index.html");
					stats = await stat(filePath);
				}
				if (!stats.isFile()) {
					res.statusCode = 404;
					return res.end();
				}
				res.statusCode = 200;
				res.setHeader(
					"Content-Type",
					CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
				);
				res.setHeader("Content-Length", stats.size);
				if (req.method === "HEAD") return res.end();
				createReadStream(filePath).pipe(res);
			} catch {
				res.statusCode = 404;
				res.end();
			}
		})();
	};
}

/** Where the `/sync` WebSocket proxy forwards to — the daemon's CRDT socket. */
export interface WebServeSyncTarget {
	host: string;
	port: number;
}

const DEFAULT_SYNC_TARGET: WebServeSyncTarget = { host: "127.0.0.1", port: 42000 };
const DEFAULT_SIDECAR_TARGET: WebServeSyncTarget = { host: "127.0.0.1", port: 42001 };

/** Headers a WebSocket handshake needs; everything else stays behind the proxy. */
const SYNC_FORWARD_HEADERS = [
	"upgrade",
	"connection",
	"sec-websocket-key",
	"sec-websocket-version",
	"sec-websocket-protocol",
	"sec-websocket-extensions",
] as const;

/**
 * Forward a `/sync` upgrade to the daemon and pipe bytes both ways. The request
 * line is rewritten to the daemon's root — the upstream contract is "the CRDT
 * WS", not our proxy path. Anything outside `/sync` is destroyed: this server
 * proxies exactly one thing.
 */
function handleSyncUpgrade(
	target: WebServeSyncTarget,
	req: IncomingMessage,
	clientSocket: Socket,
	head: Buffer,
): void {
	const url = new URL(req.url ?? "/", "http://localhost");
	if (url.pathname !== "/sync") {
		clientSocket.destroy();
		return;
	}
	const upstream = connect(target.port, target.host, () => {
		const lines = [`GET / HTTP/1.1`, `Host: ${target.host}:${target.port}`];
		for (const name of SYNC_FORWARD_HEADERS) {
			const value = req.headers[name];
			if (typeof value === "string") lines.push(`${name}: ${value}`);
		}
		upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
		if (head.length > 0) upstream.write(head);
		upstream.pipe(clientSocket);
		clientSocket.pipe(upstream);
	});
	const teardown = () => {
		upstream.destroy();
		clientSocket.destroy();
	};
	upstream.on("error", teardown);
	clientSocket.on("error", teardown);
}

export interface WebServeTlsOptions {
	certFile: string;
	keyFile: string;
}

/** Start the static hub server and resolve once bound. With `tls` the origin is
 *  https — the secure context service workers and OPFS/WASM demand off-localhost. */
export function startWebServeServer(
	rootDir: string,
	options: {
		port: number;
		host: string;
		tls?: WebServeTlsOptions;
		syncTarget?: WebServeSyncTarget;
		sidecarTarget?: WebServeSyncTarget;
	},
): Promise<{ server: Server; url: string }> {
	const handler = createWebServeHandler(rootDir, options.sidecarTarget ?? DEFAULT_SIDECAR_TARGET);
	const server = options.tls
		? createTlsServer(
				{
					cert: readFileSync(options.tls.certFile),
					key: readFileSync(options.tls.keyFile),
				},
				handler,
			)
		: createServer(handler);
	const syncTarget = options.syncTarget ?? DEFAULT_SYNC_TARGET;
	server.on("upgrade", (req, socket, head) =>
		handleSyncUpgrade(syncTarget, req, socket as Socket, head),
	);
	const scheme = options.tls ? "https" : "http";
	return new Promise((resolve) => {
		server.listen(options.port, options.host, () => {
			const addr = server.address();
			const boundPort = typeof addr === "object" && addr ? addr.port : options.port;
			resolve({ server, url: `${scheme}://${options.host}:${boundPort}` });
		});
	});
}

interface WebServeOptions {
	port?: string;
	host?: string;
	tlsCert?: string;
	tlsKey?: string;
	syncTarget?: string;
	sidecarTarget?: string;
	json?: boolean;
}

function parseSyncTarget(value: string): WebServeSyncTarget {
	const [host, portRaw] = value.split(":");
	const port = Number.parseInt(portRaw ?? "", 10);
	if (!host || Number.isNaN(port)) {
		throw new Error(`--sync-target expects host:port, got "${value}"`);
	}
	return { host, port };
}

export function createWebServeCommand(): Command {
	return new Command("serve")
		.description("Serve a built hub directory with cross-origin-isolation headers")
		.argument("<dir>", "Directory to serve (e.g. apps/me/dist)")
		.option("--port <port>", "TCP port to listen on", "4321")
		.option(
			"--host <host>",
			"Bind address; 0.0.0.0 exposes the hub to other devices",
			"127.0.0.1",
		)
		.option("--tls-cert <file>", "TLS certificate (PEM) — with --tls-key, serves https")
		.option("--tls-key <file>", "TLS private key (PEM) — with --tls-cert, serves https")
		.option(
			"--sync-target <host:port>",
			"Daemon CRDT WS the /sync proxy forwards to",
			"127.0.0.1:42000",
		)
		.option(
			"--sidecar-target <host:port>",
			"Daemon sidecar HTTP API the /efforts proxy forwards to",
			"127.0.0.1:42001",
		)
		.option("--json", "Print the listening address as JSON")
		.action(async (dir: string, options: WebServeOptions) => {
			const port = Number.parseInt(options.port ?? "4321", 10);
			const host = options.host ?? "127.0.0.1";
			if (Boolean(options.tlsCert) !== Boolean(options.tlsKey)) {
				throw new Error("--tls-cert and --tls-key must be provided together.");
			}
			const tls =
				options.tlsCert && options.tlsKey
					? { certFile: options.tlsCert, keyFile: options.tlsKey }
					: undefined;
			const { url } = await startWebServeServer(dir, {
				port,
				host,
				...(tls ? { tls } : {}),
				syncTarget: parseSyncTarget(options.syncTarget ?? "127.0.0.1:42000"),
				sidecarTarget: parseSyncTarget(options.sidecarTarget ?? "127.0.0.1:42001"),
			});
			if (options.json) {
				process.stdout.write(`${JSON.stringify({ ok: true, url, dir: path.resolve(dir) })}\n`);
			} else {
				process.stdout.write(
					`refarm hub serving ${path.resolve(dir)} on ${url}\n` +
						"  COOP/COEP headers on — the browser runtime can boot cross-origin-isolated.\n" +
						"  /sync proxies WebSocket upgrades to the daemon (see --sync-target).\n" +
						(tls
							? "  https origin — service worker + OPFS/WASM work from other devices.\n"
							: "  Note: off-localhost origins still need --tls-cert/--tls-key (e.g. mkcert) for service worker + OPFS/WASM.\n"),
				);
			}
		});
}
