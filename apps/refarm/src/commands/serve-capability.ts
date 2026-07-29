import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { createCapabilityRegistry, type CapabilityEntry } from "@refarm.dev/capabilities";
import { mountedHttpHandler } from "@refarm.dev/capability-host";
import { DEFAULT_BIND_HOST, refuseUnguardedNonLoopbackBind } from "@refarm.dev/std";
import { authPolicyPresent } from "@refarm.dev/std/node";
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

/** Start the capability-surface listener and resolve once bound. The default bind stays
 *  loopback; exposing the surface to other devices is an explicit operator decision
 *  (`--host 0.0.0.0`) which is REFUSED unless an auth policy is configured — the same
 *  fail-closed rule the Rust daemon applies to `--http-host`.
 *
 *  Read the parity claim precisely: this shares the daemon's BIND rule, not its auth. The
 *  daemon's `--http-host` sits in front of `auth_middleware`, so a widened bind there is
 *  actually gated per request. This surface has no request-level gate at all — a
 *  configured policy is the operator's word that they set credentials up, and nothing here
 *  checks them yet. So a non-loopback bind here is opened on trust, and the earlier comment
 *  claiming "the same posture as `--http-host`" overstated it. Wiring the bearer check into
 *  this surface is tracked separately (ADR-093); it is deliberately not done in this
 *  bind-sweep slice. */
export function startServeServer(
	entries: readonly CapabilityEntry[],
	options: { port: number; host: string },
): Promise<{ server: Server; url: string }> {
	// Refused before anything is constructed; returned as a rejection so every bind refusal
	// in the substrate has the same shape at the call site.
	const refusal = refuseUnguardedNonLoopbackBind(
		options.host,
		authPolicyPresent(),
		"the capability surface (`refarm serve`)",
	);
	if (refusal) return Promise.reject(new Error(refusal));

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
			"Bind address; a non-loopback host needs REFARM_AUTH_POLICY configured or the bind is refused",
			DEFAULT_BIND_HOST,
		)
		.option("--json", "Print the listening address as JSON")
		.action(async (options: ServeOptions) => {
			const port = Number.parseInt(options.port ?? "4321", 10);
			const host = options.host ?? DEFAULT_BIND_HOST;
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
