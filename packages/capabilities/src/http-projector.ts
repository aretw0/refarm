import type { IncomingMessage, ServerResponse } from "node:http";

import type { CapabilityDescriptor, CapabilityEntry, CapabilityInput } from "./types.js";
import { isCapabilityGroup } from "./types.js";

/**
 * The HTTP projector — the fourth surface reader, beside the CLI/REPL/TUI ones.
 * A BLIND loop over `registry.list()` of ONLY the `transports.http` bucket turns
 * each verb that declares `{method, path}` into an endpoint. Because `run()` is
 * pure and returns a JSON envelope, the endpoint is nearly free: parse the
 * request into a {@link CapabilityInput}, await run(), and write the envelope
 * VERBATIM as the body — the envelope IS the response. A verb with no
 * `transports.http` gets no route (projecting is inert; only run() executes).
 *
 * Host-agnostic on purpose: it returns a `(req,res) => boolean` handler (true =
 * "I handled this route"), the exact shape farmhand's HttpSidecar.addRouteHandler
 * consumes, so the same projector mounts on any node:http server — under a
 * `/capabilities` prefix to stay off a host's effect plane.
 */

/** A resolved HTTP route: how to invoke ONE capability verb over HTTP. */
interface CapabilityRoute {
	method: string;
	path: string;
	invoke: CapabilityDescriptor["run"];
}

/** The action a group's HTTP route runs: its default action, else the group
 * itself if it is somehow flat. A group with no default action gets no route. */
function groupHttpAction(entry: CapabilityEntry): CapabilityDescriptor | null {
	if (!isCapabilityGroup(entry)) return entry;
	if (!entry.defaultAction) return null;
	return entry.actions[entry.defaultAction] ?? null;
}

/** Build the route table once from the registry's `transports.http` bucket. */
export function buildCapabilityRoutes(
	entries: readonly CapabilityEntry[],
	prefix = "",
): CapabilityRoute[] {
	const routes: CapabilityRoute[] = [];
	for (const entry of entries) {
		const http = entry.transports?.http;
		if (!http?.path) continue;
		const action = groupHttpAction(entry);
		if (!action) continue;
		routes.push({
			method: (http.method ?? "POST").toUpperCase(),
			path: `${prefix}${http.path}`,
			invoke: action.run,
		});
	}
	return routes;
}

/** Read a request body as JSON `{args?, options?}`; empty body → `{}`. */
async function readInput(req: IncomingMessage): Promise<{
	args: CapabilityInput["args"];
	options: CapabilityInput["options"];
}> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
	}
	const raw = Buffer.concat(chunks).toString("utf-8").trim();
	if (!raw) return { args: {}, options: {} };
	const parsed = JSON.parse(raw) as {
		args?: CapabilityInput["args"];
		options?: CapabilityInput["options"];
	};
	return { args: parsed.args ?? {}, options: parsed.options ?? {} };
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
 * A node:http route handler that projects every registered capability with a
 * `transports.http` declaration. Returns true iff it matched (and answered) the
 * request, so it composes with a host's other route handlers. The response status
 * follows the envelope: a `run()` success → 200, an error envelope (`ok === false`)
 * → 4xx/5xx, a malformed request body → 400, and a thrown run() → 500 wrapped as
 * a JSON error (never a bare crash).
 */
export function createCapabilityRouteHandler(
	entries: readonly CapabilityEntry[],
	options: { prefix?: string } = {},
): (req: IncomingMessage, res: ServerResponse) => boolean {
	const routes = buildCapabilityRoutes(entries, options.prefix ?? "");
	return (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const method = (req.method ?? "GET").toUpperCase();
		const route = routes.find((r) => r.method === method && r.path === url.pathname);
		if (!route) return false;
		void (async () => {
			let input: CapabilityInput;
			try {
				const { args, options: opts } = await readInput(req);
				input = { args, options: opts, json: true };
			} catch {
				writeJson(res, 400, {
					ok: false,
					error: "invalid-request-body",
					message: "Request body must be JSON: {args?, options?}.",
				});
				return;
			}
			try {
				const envelope = await route.invoke(input);
				const ok = (envelope as { ok?: boolean }).ok !== false;
				writeJson(res, ok ? 200 : 422, envelope);
			} catch (error) {
				writeJson(res, 500, {
					ok: false,
					error: "capability-run-failed",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		})();
		return true;
	};
}
