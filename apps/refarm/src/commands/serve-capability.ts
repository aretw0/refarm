import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { createCapabilityRegistry, type CapabilityEntry } from "@refarm.dev/capabilities";
import { mountedHttpHandler } from "@refarm.dev/capability-host";
import { Command } from "commander";

import { capabilityRegistry } from "./capability-registry.js";
import { createEffortProxyHandler } from "./effort-proxy.js";

/**
 * `refarm serve` — the capability HTTP surface. Mounts the two projectors that
 * existed but were unmounted, giving the declare-once capability registry its
 * fourth invoker (HTTP) and its web-facing agent-tool introspection:
 *
 *   POST/GET /capabilities/<path>  → createCapabilityRouteHandler (http-projector):
 *      every verb declaring `transports.http` becomes an endpoint whose body is the
 *      run() envelope verbatim.
 *   GET      /agent-tools          → capabilityAnthropicTools (agent-projector): the
 *      registry's agent-eligible verbs (`transports.agent.tool`) as tool schemas —
 *      what a browser/agent UI lists. This is the deliberate consumer the web-surface
 *      projector was built for (it stays OFF the live Rust agent path).
 *   GET      /openapi.json         → OpenAPI 3.1 spec generated from the same
 *      `transports.http` metadata, so Swagger-like clients can discover the API.
 *
 * Complements `refarm web` (a UI LAUNCHER); this exposes the capability API those
 * UIs call. Pure-TS, no runtime/WASM — the projectors read the in-process registry.
 */

/**
 * The composed request handler — the testable core. Tries the capability route
 * handler (`/capabilities/*`), then generic introspection routes (`/agent-tools`,
 * `/openapi.json`), else 404. Pure over the injected `entries` so a test drives
 * it with any registry.
 */
export function createServeHandler(
	entries: readonly CapabilityEntry[],
): (req: IncomingMessage, res: ServerResponse) => void {
	// ADR-088: front the capability handler with the same-origin effort proxy, so a
	// browser chat face served here can submit/cancel efforts on the sidecar without a
	// cross-origin request (zero CORS by default). `/efforts*` proxies to the sidecar;
	// everything else is the capability surface as before.
	return createEffortProxyHandler(mountedHttpHandler(createCapabilityRegistry(entries)));
}

/** Stand a `node:http` server for the capability surface. Returns the server so the
 * caller (or a test) can read its address and close it. */
export function createServeServer(entries: readonly CapabilityEntry[]): Server {
	return createServer(createServeHandler(entries));
}

interface ServeOptions {
	port?: string;
	host?: string;
	json?: boolean;
}

/** Start the capability-surface listener and resolve once bound. The default bind
 *  stays loopback; exposing the surface to other devices is an explicit operator
 *  decision (`--host 0.0.0.0`) — the same posture as the Rust daemon's `--http-host`. */
export function startServeServer(
	entries: readonly CapabilityEntry[],
	options: { port: number; host: string },
): Promise<{ server: Server; url: string }> {
	const server = createServeServer(entries);
	return new Promise((resolve) => {
		server.listen(options.port, options.host, () => {
			const addr = server.address();
			const boundPort = typeof addr === "object" && addr ? addr.port : options.port;
			resolve({ server, url: `http://${options.host}:${boundPort}` });
		});
	});
}

function createServeCommand(): Command {
	return new Command("serve")
		.description("Serve the capability HTTP surface (/capabilities/* + /agent-tools)")
		.option("--port <port>", "TCP port to listen on", "4321")
		.option(
			"--host <host>",
			"Bind address; 0.0.0.0 exposes the surface to other devices",
			"127.0.0.1",
		)
		.option("--json", "Print the listening address as JSON")
		.action(async (options: ServeOptions) => {
			const port = Number.parseInt(options.port ?? "4321", 10);
			const host = options.host ?? "127.0.0.1";
			const { url } = await startServeServer(capabilityRegistry.list(), { port, host });
			if (options.json) {
				process.stdout.write(`${JSON.stringify({ ok: true, url })}\n`);
			} else {
				process.stdout.write(
					`refarm capability surface listening on ${url}\n` +
						`  GET  ${url}/agent-tools            — agent tool schemas\n` +
						`  GET  ${url}/openapi.json           — OpenAPI capability spec\n` +
						`  POST ${url}/capabilities/<verb>    — run a capability\n`,
				);
			}
		});
}

export const serveCommand = createServeCommand();
