import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { createCapabilityRegistry, type CapabilityEntry } from "@refarm.dev/capabilities";
import { mountedHttpHandler } from "@refarm.dev/capability-host";
import {
	resolveDeclaredSurfaceBind,
	SURFACE_CAPABILITIES,
	type SurfaceCatalog,
	type TailnetSelfResolution,
} from "@refarm.dev/std";
import { Command } from "commander";

import { capabilityRegistry } from "./capability-registry.js";
import { createEffortProxyHandler } from "./effort-proxy.js";
import { readSurfacesFromFilesystem, resolveTailnetSelfIpv4 } from "./web-surface.js";

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

/**
 * Start the capability-surface listener and resolve once bound.
 *
 * WHICH SURFACE THIS IS: `capabilities`. Surfaces are named for LISTENERS, and this is the
 * listener the 07-29 design's example block calls `capabilities` — the capability HTTP API
 * (`/capabilities/*`, `/agent-tools`, `/openapi.json`, and the `/efforts` proxy).
 *
 * WHERE THE BIND COMES FROM (O5,
 * docs/superpowers/specs/2026-07-30-open-by-declaration-surfaces-design.md): the
 * `surfaces.capabilities` declaration in the FILESYSTEM `.refarm/config.json`, and nothing
 * else. It used to come from `authPolicyPresent()` — "does REFARM_AUTH_POLICY name a file that
 * exists" — which measured the wrong thing entirely: this surface reads no `Authorization`
 * header on any route, so a policy file belonging to some OTHER surface was permitting a bind
 * that nothing here would gate. That is the appearance of a gate without a gate (S3).
 *
 * `surfaceEnforceableGate("capabilities")` is therefore `null`, which is not an oversight but
 * the honest entry: `"gate": "device-token"` is REFUSED for this surface at every expose,
 * loopback included, and `"gate": "none"` — deliberately open, admitted devices only — is what
 * it can truthfully declare. Wiring a real bearer check here (ADR-093) would change that entry,
 * and until it does, the vocabulary will not let this surface claim one.
 */
export function startServeServer(
	entries: readonly CapabilityEntry[],
	options: {
		port: number;
		/** The `--host` value the operator passed, or `undefined` when they passed none. The
		 *  absence is meaningful — it is what lets `surfaces.capabilities` decide (S1/S5). */
		host?: string | undefined;
		/** The declaration this bind obeys. Injected by tests; production reads the FILESYSTEM
		 *  `.refarm/config.json` under `configRoot`, never the replicated config node. */
		surfaces?: SurfaceCatalog;
		configRoot?: string;
		/** Seam for `expose: "tailnet"` resolution — see `web-surface.ts`. */
		resolveTailnet?: () => TailnetSelfResolution;
	},
): Promise<{ server: Server; url: string }> {
	// Refused before anything is constructed; returned as a rejection so every bind refusal
	// in the substrate has the same shape at the call site.
	let host: string;
	try {
		const surfaces = options.surfaces ?? readSurfacesFromFilesystem(options.configRoot);
		({ host } = resolveDeclaredSurfaceBind({
			surface: SURFACE_CAPABILITIES,
			surfaces,
			flagHost: options.host,
			label: "the capability surface (`refarm serve`)",
			resolveTailnet: options.resolveTailnet ?? resolveTailnetSelfIpv4,
		}));
	} catch (error) {
		return Promise.reject(error instanceof Error ? error : new Error(String(error)));
	}

	const server = createServeServer(entries);
	return new Promise((resolve) => {
		// `host`, never `options.host`: the RESOLVED value is what the declaration permitted, and
		// with an absent flag it is the only value there is.
		server.listen(options.port, host, () => {
			const addr = server.address();
			const boundPort = typeof addr === "object" && addr ? addr.port : options.port;
			resolve({ server, url: `http://${host}:${boundPort}` });
		});
	});
}

function createServeCommand(): Command {
	return (
		new Command("serve")
			.description("Serve the capability HTTP surface (/capabilities/* + /agent-tools)")
			.option("--port <port>", "TCP port to listen on", "4321")
			// NO DEFAULT VALUE, deliberately — the same defect `refarm web serve` carried. Under S5
			// ("a flag may only narrow the declaration") a CLI default stops being neutral: a `--host`
			// that ALWAYS carried `127.0.0.1` would ALWAYS be present and ALWAYS narrow, so a
			// `surfaces.capabilities` declaration could never take effect and nothing would say so.
			// The declaration would be inert AND silent. An absent flag means "let the declaration
			// decide"; loopback remains what an absent DECLARATION resolves to (S1).
			.option(
				"--host <host>",
				"Bind address. Absent, the `surfaces.capabilities` declaration in .refarm/config.json " +
					"decides (undeclared ⇒ loopback). A value may only narrow that declaration, never widen it",
			)
			.option("--json", "Print the listening address as JSON")
			.action(async (options: ServeOptions) => {
				const port = Number.parseInt(options.port ?? "4321", 10);
				const { url } = await startServeServer(capabilityRegistry.list(), {
					port,
					// Passed through EXACTLY as commander gave it, `undefined` included — see the
					// `--host` option above for why the absence must survive this call.
					...(options.host !== undefined ? { host: options.host } : {}),
				});
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
			})
	);
}

export const serveCommand = createServeCommand();
