import {
	buildCapabilityOpenApiDocument,
	buildPaletteModel,
	capabilityAnthropicTools,
	createCapabilityRegistry,
	createCapabilityRouteHandler,
	type CapabilityEntry,
	type CapabilityRegistry,
} from "@refarm.dev/capabilities";
import {
	capabilityCliCommands,
	type CapabilityHooksResolver,
} from "@refarm.dev/surface-terminal";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

import {
	builtinCapabilities,
	type CapabilityDeps,
} from "./builtin-capabilities.js";
import {
	registerPluginCapabilities,
	type PluginDescriptorDeps,
	type SurfaceableManifest,
} from "./plugin-bridge.js";

/**
 * The consumer-mount seam — the ONE call a white-label app makes to turn its deps +
 * extensions into a live capability registry. It bundles the whole two-layer wiring:
 * the neutral base blocks (from an injected deps bundle), the app's own JS work
 * verbs, and any plugin-manifest verbs surfaced via the bridge. The result projects to
 * CLI / REPL / TUI / HTTP / agent from the shared projectors.
 *
 * A consuming app is then just: its persona deps + verbs + one `mountCapabilities`
 * call. This is what makes a per-work example thin — the boilerplate lives here.
 */
export interface MountOptions {
	/** The deps bundle for the neutral blocks (source/records/vault). */
	deps: CapabilityDeps;
	/** The app's own work verbs (JS CapabilityDescriptors/-Groups), added alongside the
	 * built-ins. */
	verbs?: CapabilityEntry[];
	/** Plugin manifests whose dispatchable verbs are surfaced via the bridge: declare
	 * once, project to every surface. */
	manifests?: SurfaceableManifest[];
	/** Deps for the surfaced plugin verbs (how they submit efforts). Required when
	 * `manifests` is non-empty. */
	pluginDeps?: PluginDescriptorDeps;
	/** Reserved slash names the registry should refuse (defaults to none). */
	reservedNames?: Iterable<string>;
}

/** Build the composed capability registry for a consuming app. */
export function mountCapabilities(options: MountOptions): CapabilityRegistry {
	const entries: CapabilityEntry[] = [
		...builtinCapabilities(options.deps),
		...(options.verbs ?? []),
	];
	const registry = createCapabilityRegistry(entries, options.reservedNames ?? []);

	const manifests = options.manifests ?? [];
	if (manifests.length > 0) {
		if (!options.pluginDeps) {
			throw new Error(
				"mountCapabilities: `manifests` given without `pluginDeps` (how surfaced verbs submit)",
			);
		}
		registerPluginCapabilities(registry, manifests, options.pluginDeps);
	}

	return registry;
}

/** The top-level CLI commands for a mounted registry — feed each to a Commander
 * `program.addCommand(...)`. A thin re-projection so a consumer never re-implements the
 * projector wiring; `hooksFor` defaults to no surface hooks. */
export function mountedCliCommands(
	registry: CapabilityRegistry,
	hooksFor: CapabilityHooksResolver = () => ({}),
): ReturnType<typeof capabilityCliCommands> {
	return capabilityCliCommands(registry.list(), hooksFor);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

/**
 * An HTTP request handler for a mounted registry — the WEB surface, the same one the
 * host app's `serve` stands up, now reusable by any consumer. Every verb declaring
 * `transports.http` becomes an endpoint under `prefix` (default `/capabilities`); a
 * `GET /agent-tools` route introspects the tool schemas; everything else 404s. This is
 * the HTTP twin of {@link mountedCliCommands}: a consumer never re-implements the route
 * wiring.
 */
export function mountedHttpHandler(
	registry: CapabilityRegistry,
	options: { prefix?: string; openApiPath?: string; openApiTitle?: string; openApiVersion?: string } = {},
): (req: IncomingMessage, res: ServerResponse) => void {
	const entries = registry.list();
	const prefix = options.prefix ?? "/capabilities";
	const routeHandler = createCapabilityRouteHandler(entries, {
		prefix,
	});
	const openApiPath = options.openApiPath ?? "/openapi.json";
	return (req, res) => {
		if (routeHandler(req, res)) return;
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const method = (req.method ?? "GET").toUpperCase();
		if (method === "GET" && url.pathname === "/agent-tools") {
			writeJson(res, 200, { tools: capabilityAnthropicTools(entries) });
			return;
		}
		// GET /palette — the quick-switcher (cmd-K) face: the registry's renderers.palette
		// verbs as a grouped, ranked model a switcher renders. Was orphaned (built, mounted
		// by nothing); this is its transport, the twin of /agent-tools for the palette axis.
		if (method === "GET" && url.pathname === "/palette") {
			writeJson(res, 200, buildPaletteModel(registry));
			return;
		}
		if (method === "GET" && url.pathname === openApiPath) {
			writeJson(
				res,
				200,
				buildCapabilityOpenApiDocument(entries, {
					prefix,
					...(options.openApiTitle ? { title: options.openApiTitle } : {}),
					...(options.openApiVersion ? { version: options.openApiVersion } : {}),
				}),
			);
			return;
		}
		writeJson(res, 404, {
			ok: false,
			error: "not-found",
			message: `No capability surface at ${method} ${url.pathname}.`,
		});
	};
}

/**
 * A live web server standing up a mounted registry's HTTP surface — the ONE call a
 * consumer makes to serve its verbs (the twin of mounting the CLI). `port: 0` picks a
 * free port. Returns `{ server, listening, close }`.
 *
 * HANGING SAFETY (a serve surface must never wedge a client or the process):
 *   - Every request has a hard timeout (`requestTimeoutMs`, default 15s): if a verb's
 *     run() never resolves, the server responds 504 instead of holding the socket open
 *     forever. The underlying route handler awaits run() with no timeout of its own, so
 *     this is the net that protects any consumer.
 *   - `keepAliveTimeout` is short so idle connections don't keep the process alive after
 *     the caller is done — a POC serve should exit cleanly.
 *   - `close()` shuts the server AND destroys open sockets, so a `finally { await close() }`
 *     always returns (a lingering keep-alive socket can otherwise make `server.close()`
 *     hang until the client disconnects).
 */
export function serveCapabilities(
	registry: CapabilityRegistry,
	options: {
		port?: number;
		prefix?: string;
		requestTimeoutMs?: number;
		openApiPath?: string;
		openApiTitle?: string;
		openApiVersion?: string;
	} = {},
): {
	server: Server;
	listening: Promise<{ port: number }>;
	close: () => Promise<void>;
} {
	const handler = mountedHttpHandler(registry, {
		prefix: options.prefix,
		openApiPath: options.openApiPath,
		openApiTitle: options.openApiTitle,
		openApiVersion: options.openApiVersion,
	});
	const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;

	const server = createServer((req, res) => {
		// Net against a run() that never resolves: if nothing was written in time, 504.
		const timer = setTimeout(() => {
			if (!res.headersSent) {
				writeJson(res, 504, {
					ok: false,
					error: "capability-timeout",
					message: `No response within ${requestTimeoutMs}ms.`,
				});
			}
			res.destroy();
		}, requestTimeoutMs);
		if (typeof timer.unref === "function") timer.unref();
		res.on("close", () => clearTimeout(timer));
		handler(req, res);
	});
	// Don't let idle keep-alive sockets hold the process open.
	server.keepAliveTimeout = 1_000;

	const sockets = new Set<import("node:net").Socket>();
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});

	const listening = new Promise<{ port: number }>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 0, () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr ? addr.port : (options.port ?? 0);
			resolve({ port });
		});
	});

	const close = () =>
		new Promise<void>((resolve) => {
			for (const socket of sockets) socket.destroy();
			sockets.clear();
			server.close(() => resolve());
		});

	return { server, listening, close };
}
