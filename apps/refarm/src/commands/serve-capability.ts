import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { mountedHttpHandler } from "@refarm.dev/capability-host";
import {
	createCapabilityRegistry,
	type CapabilityEntry,
} from "@refarm.dev/cli/capabilities";
import { Command } from "commander";

import { capabilityRegistry } from "./capability-registry.js";

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
	return mountedHttpHandler(createCapabilityRegistry(entries));
}

/** Stand a `node:http` server for the capability surface. Returns the server so the
 * caller (or a test) can read its address and close it. */
export function createServeServer(entries: readonly CapabilityEntry[]): Server {
	return createServer(createServeHandler(entries));
}

interface ServeOptions {
	port?: string;
	json?: boolean;
}

function createServeCommand(): Command {
	return new Command("serve")
		.description("Serve the capability HTTP surface (/capabilities/* + /agent-tools)")
		.option("--port <port>", "TCP port to listen on", "4321")
		.option("--json", "Print the listening address as JSON")
		.action((options: ServeOptions) => {
			const port = Number.parseInt(options.port ?? "4321", 10);
			const server = createServeServer(capabilityRegistry.list());
			server.listen(port, "127.0.0.1", () => {
				const addr = server.address();
				const boundPort = typeof addr === "object" && addr ? addr.port : port;
				const url = `http://127.0.0.1:${boundPort}`;
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
		});
}

export const serveCommand = createServeCommand();
