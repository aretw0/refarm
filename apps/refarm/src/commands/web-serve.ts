import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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

export function createWebServeHandler(
	rootDir: string,
): (req: IncomingMessage, res: ServerResponse) => void {
	const root = path.resolve(rootDir);
	return (req, res) => {
		void (async () => {
			writeIsolationHeaders(res);
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.statusCode = 405;
				res.setHeader("Allow", "GET, HEAD");
				return res.end();
			}
			const url = new URL(req.url ?? "/", "http://localhost");
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

/** Start the static hub server and resolve once bound. */
export function startWebServeServer(
	rootDir: string,
	options: { port: number; host: string },
): Promise<{ server: Server; url: string }> {
	const server = createServer(createWebServeHandler(rootDir));
	return new Promise((resolve) => {
		server.listen(options.port, options.host, () => {
			const addr = server.address();
			const boundPort = typeof addr === "object" && addr ? addr.port : options.port;
			resolve({ server, url: `http://${options.host}:${boundPort}` });
		});
	});
}

interface WebServeOptions {
	port?: string;
	host?: string;
	json?: boolean;
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
		.option("--json", "Print the listening address as JSON")
		.action(async (dir: string, options: WebServeOptions) => {
			const port = Number.parseInt(options.port ?? "4321", 10);
			const host = options.host ?? "127.0.0.1";
			const { url } = await startWebServeServer(dir, { port, host });
			if (options.json) {
				process.stdout.write(`${JSON.stringify({ ok: true, url, dir: path.resolve(dir) })}\n`);
			} else {
				process.stdout.write(
					`refarm hub serving ${path.resolve(dir)} on ${url}\n` +
						"  COOP/COEP headers on — the browser runtime can boot cross-origin-isolated.\n" +
						"  Note: off-localhost origins still need HTTPS for service worker + OPFS/WASM.\n",
				);
			}
		});
}
