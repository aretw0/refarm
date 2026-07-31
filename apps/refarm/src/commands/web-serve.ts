import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
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

import { type SurfaceCatalog } from "@refarm.dev/std";
import { Command } from "commander";

import { createAttendSurface, type AttendSurface } from "./web-serve-attend.js";
import { createSasVerificationSurface, type SasVerificationSurface } from "./web-serve-sas.js";
import {
	readSurfacesFromFilesystem,
	resolveWebBindHost,
	type TailnetSelfResolution,
} from "./web-surface.js";

/**
 * `refarm web serve <dir>` — the missing hub-serve command (outward horizon).
 *
 * A hardened static server for a built hub (`apps/me/dist` and kin), sending the
 * cross-origin-isolation headers on every response — without COOP/COEP the
 * browser refuses `crossOriginIsolated`, and the hub's OPFS-SQLite/WASM runtime
 * cannot boot off-localhost. Loopback unless the `surfaces.web` declaration says
 * otherwise. Serving is read-only: GET/HEAD, root-contained paths.
 *
 * WHERE THE BIND COMES FROM (O5,
 * docs/superpowers/specs/2026-07-30-open-by-declaration-surfaces-design.md):
 * the `surfaces.web` declaration in the FILESYSTEM `.refarm/config.json`, and
 * nothing else. It used to come from "does REFARM_AUTH_POLICY name a file that
 * exists" — a criterion that measured the wrong thing entirely, since this
 * listener never reads `Authorization`, not once. A surface that verifies no
 * bearer may not claim a gate (S3); what it CAN do is say `"gate": "none"` and
 * mean it. See `web-surface.ts` for the whole rule.
 *
 * WHY THAT IS LOAD-BEARING HERE, not merely consistent: this server is not only
 * static. It PROXIES `/sync` WebSocket upgrades to the daemon's CRDT socket on
 * `127.0.0.1:42000` and the sidecar API to `127.0.0.1:42001`. O6: those routes
 * share this listener, so declaring the surface open opens them too — it cannot
 * be waved off as "a different surface". They are admissible because the caller's
 * credential is FORWARDED and the upstream gate still enforces (proven by
 * `web-serve.test.ts`'s three probes through each proxy route), and only while a
 * credential policy is actually live on this node (`proxiedUpstreamsAreGated`).
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
 * hits the static server and 405s (which broke the phone chat over a tunnel).
 *
 * `/prompts` joined them so `/attend` can call `GET /prompts` and
 * `POST /prompts/:id/answer` same-origin — no CORS to arrange, no preflight, and no
 * second origin for a credential to be scoped to. It widens NOTHING: the request's
 * `Authorization` is forwarded untouched and the Rust gate is still the only thing that
 * decides, which is exactly the reasoning O6 already accepted for the routes above. What
 * makes it safe to add is that the gate now judges those two paths by SCOPE — a
 * `prompt:answer` credential passes there and nowhere else, and `POST /prompts`
 * (publishing a question) stays device-only on the same path. */
const SIDECAR_API_PREFIXES = [
	"/efforts",
	"/sessions",
	"/nodes",
	"/tasks",
	"/plugins",
	"/prompts",
] as const;

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

/**
 * The one file served with a conditional-request policy — the first slice of
 * docs/superpowers/specs/2026-07-30-declared-traffic-budget-design.md.
 *
 * `farm-update` fetches this on every run, on every device, forever, and it is the ONLY fetch
 * in that flow with no policy: the payload layer is already content-addressed (`planUpdate`
 * downloads only files whose sha256 changed), so the manifest is the control fetch that pays
 * full price every time. An `ETag` + `304` makes the common case — nothing changed — cost a
 * header exchange instead of a document.
 *
 * DELIBERATELY just this one name, not a vocabulary. T3: "do not build a DSL"; the general
 * three-knob declaration (`freshness`, `floor`, `live`) is a later slice, and building the
 * framework ahead of its second consumer is how a floor becomes a burden.
 */
const CONDITIONAL_FILE = "manifest.json";

/** A STRONG ETag over the file's bytes. Strong (unquoted-by-`W/`) because it is derived from
 *  the content itself, so byte-identical content always produces the identical validator and
 *  a match really does mean "you already have exactly this". PURE. */
export function manifestETag(bytes: Buffer | string): string {
	return `"${createHash("sha256").update(bytes).digest("hex")}"`;
}

/** Does the client's `If-None-Match` cover `etag`? RFC 9110 allows a comma-separated list and
 *  the wildcard `*`; a `W/` prefix on an offered validator is tolerated on the way in (a client
 *  may weaken what we sent), it is simply never something this server emits. PURE. */
export function ifNoneMatchMatches(header: string | undefined, etag: string): boolean {
	if (!header) return false;
	const offered = header.split(",").map((entry) => entry.trim());
	if (offered.includes("*")) return true;
	return offered.some((entry) => (entry.startsWith("W/") ? entry.slice(2) : entry) === etag);
}

export function createWebServeHandler(
	rootDir: string,
	sidecarTarget?: WebServeSyncTarget,
	sas?: SasVerificationSurface,
	attend?: AttendSurface,
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
			// The emoji-SAS exchange, BEFORE the isolation headers and before the static
			// root: it is an API on this listener, not a file under it, and it must not
			// be shadowed by a directory someone happens to have called `auth`.
			if (sas && (await sas.handle(req, res, url.pathname))) return;
			// The attend page, for the same reason and in the same position: a route on
			// this listener, never a file under its root. That root IS the cold-bootstrap
			// kit and must stay exactly what `refarm dist publish` put there.
			if (attend && (await attend.handle(req, res, url.pathname))) return;
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
				const contentType =
					CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
				if (path.basename(filePath) === CONDITIONAL_FILE) {
					// Read it whole: the validator is derived from the BYTES, so there is nothing to
					// compare against until they are in hand. The manifest is a small control
					// document by construction (paths + hashes), which is exactly why it is the one
					// file worth spending a read on to save a transfer.
					const bytes = await readFile(filePath);
					const etag = manifestETag(bytes);
					res.setHeader("ETag", etag);
					if (ifNoneMatchMatches(req.headers["if-none-match"], etag)) {
						// 304 carries no body and no Content-Length — the client keeps what it has.
						res.statusCode = 304;
						return res.end();
					}
					res.statusCode = 200;
					res.setHeader("Content-Type", contentType);
					res.setHeader("Content-Length", bytes.length);
					if (req.method === "HEAD") return res.end();
					return res.end(bytes);
				}
				res.statusCode = 200;
				res.setHeader("Content-Type", contentType);
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
		/** The `--host` value the operator passed, or `undefined` when they passed none. The
		 *  absence is meaningful — it is what lets `surfaces.web` decide (S1/S5). */
		host?: string | undefined;
		tls?: WebServeTlsOptions;
		syncTarget?: WebServeSyncTarget;
		sidecarTarget?: WebServeSyncTarget;
		/** The declaration this bind obeys. Injected by tests; production reads the FILESYSTEM
		 *  `.refarm/config.json` under `configRoot`, never the replicated config node. */
		surfaces?: SurfaceCatalog;
		configRoot?: string;
		/** Seam for `expose: "tailnet"` resolution — see `web-surface.ts`. */
		resolveTailnet?: () => TailnetSelfResolution;
		/**
		 * The emoji-SAS verification surface. Built by default from the sovereign root,
		 * so `refarm web serve` carries it without a flag; pass a value to point it at a
		 * throwaway policy (which is what every test does), or `null` to leave it off
		 * entirely for a listener that should serve nothing but files.
		 */
		sas?: SasVerificationSurface | null;
		/**
		 * The `/attend` page. Built by default, so `refarm web serve` carries it without a
		 * flag; pass `null` for a listener that should serve nothing but files. There is no
		 * per-instance state to inject — the page is a constant and the prompts live on the
		 * daemon, reached through the sidecar proxy like every other API path here.
		 */
		attend?: AttendSurface | null;
	},
): Promise<{ server: Server; url: string }> {
	// Fail closed BEFORE building the server: the bind is decided by the `surfaces.web`
	// declaration (S1/S3/S5 + O6), never by a policy file existing somewhere on the machine.
	// Checked before anything is constructed — no server object, no cert read from disk, no
	// socket — so a refused bind leaves nothing behind. Returned as a REJECTION rather than a
	// synchronous throw so every bind refusal in the substrate has the same shape at the call
	// site (`serveCapabilities` rejects too); `await` sees the same thing either way, but a
	// caller holding the promise without awaiting immediately does not.
	let host: string;
	try {
		const surfaces = options.surfaces ?? readSurfacesFromFilesystem(options.configRoot);
		({ host } = resolveWebBindHost({
			flagHost: options.host,
			surfaces,
			...(options.resolveTailnet ? { resolveTailnet: options.resolveTailnet } : {}),
		}));
	} catch (error) {
		return Promise.reject(error instanceof Error ? error : new Error(String(error)));
	}

	const sas =
		options.sas === null
			? undefined
			: (options.sas ??
				createSasVerificationSurface(
					options.configRoot === undefined ? {} : { configRoot: options.configRoot },
				));
	const attend = options.attend === null ? undefined : (options.attend ?? createAttendSurface());
	const handler = createWebServeHandler(
		rootDir,
		options.sidecarTarget ?? DEFAULT_SIDECAR_TARGET,
		sas,
		attend,
	);
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
		// `host`, never `options.host`: the RESOLVED value is what the declaration permitted, and
		// with an absent flag it is the only value there is.
		server.listen(options.port, host, () => {
			const addr = server.address();
			const boundPort = typeof addr === "object" && addr ? addr.port : options.port;
			resolve({ server, url: `${scheme}://${host}:${boundPort}` });
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
		// NO DEFAULT VALUE, deliberately. Under S5 ("a flag may only narrow the declaration") a
		// CLI default stops being neutral: a `--host` that ALWAYS carried `127.0.0.1` would
		// ALWAYS be present and ALWAYS narrow, so a `surfaces.web` declaration could never take
		// effect — the declaration would be inert and nothing would say so. That is the exact
		// bug the Rust side found in `--http-host` and fixed by making it an `Option`. An absent
		// flag means "let the declaration decide"; loopback remains what an absent DECLARATION
		// resolves to (S1).
		.option(
			"--host <host>",
			"Bind address. Absent, the `surfaces.web` declaration in .refarm/config.json decides " +
				"(undeclared ⇒ loopback). A value may only narrow that declaration, never widen it",
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
			if (Boolean(options.tlsCert) !== Boolean(options.tlsKey)) {
				throw new Error("--tls-cert and --tls-key must be provided together.");
			}
			const tls =
				options.tlsCert && options.tlsKey
					? { certFile: options.tlsCert, keyFile: options.tlsKey }
					: undefined;
			const { url } = await startWebServeServer(dir, {
				port,
				// Passed through EXACTLY as commander gave it, `undefined` included — see the
				// `--host` option above for why the absence must survive this call.
				...(options.host !== undefined ? { host: options.host } : {}),
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
						`  ${url}/auth/verify — a surface with no credential can ask to be vouched for;\n` +
						"    confirm the seven emoji with `refarm auth verify` at this node.\n" +
						`  ${url}/attend — answer the farm's pending questions from a browser;\n` +
						"    it runs the same seven-emoji handshake, then holds a scoped, expiring credential.\n" +
						(tls
							? "  https origin — service worker + OPFS/WASM work from other devices.\n"
							: "  Note: off-localhost origins still need --tls-cert/--tls-key (e.g. mkcert) for service worker + OPFS/WASM.\n"),
				);
			}
		});
}
