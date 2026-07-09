import { fetchSidecarJson, type SidecarJsonRequestOptions } from "@refarm.dev/sidecar-client";

import type { CallRespond } from "@refarm.dev/capabilities-v1";

/**
 * The real `callRespond` for a loaded plugin — the seam that lets an app use a WASM
 * provider (createWasmSourceProvider / createWasmEnrichmentProvider) against a RUNNING
 * runtime instead of importing the provider as an in-process library. It POSTs to the
 * runtime's `POST /plugins/:id/respond` (ADR-084's synchronous respond surface): body
 * `{ verb, payload }`, reply `{ ok, reply }` on success or `{ ok:false, error }`.
 *
 * This closes "import less, extend more" for providers: with it, an example declares its
 * source/enrichment as a loaded plugin and calls it over the wire, no TS import of the
 * provider's code. Without it, createWasmSourceProvider had no host-backed callRespond, so
 * examples fell back to importing the provider library directly.
 */

export interface SidecarRespondOptions extends SidecarJsonRequestOptions {
	/** The runtime sidecar base URL, e.g. http://127.0.0.1:42001. */
	baseUrl: string;
	/** The loaded plugin's id (the `:id` in the route). */
	pluginId: string;
}

interface RespondBody {
	ok: boolean;
	reply?: string;
	error?: string;
}

/**
 * Build a `CallRespond` bound to one plugin on one runtime. Each call POSTs the verb +
 * payload and returns the plugin's `reply` string, or throws with the runtime's error
 * (e.g. "not-supported" when the verb isn't a declared sync verb) so the caller's own
 * error handling (the adapter's discover/status marshalling) surfaces it honestly.
 */
export function createSidecarCallRespond(options: SidecarRespondOptions): CallRespond {
	const baseUrl = options.baseUrl.replace(/\/+$/, "");
	const url = `${baseUrl}/plugins/${encodeURIComponent(options.pluginId)}/respond`;

	return async (verb: string, payload: string): Promise<string> => {
		const body = await fetchSidecarJson<RespondBody>(
			url,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ verb, payload }),
			},
			{ ...options, errorLabel: options.errorLabel ?? "plugin respond" },
		);
		if (!body.ok) {
			throw new Error(
				`plugin "${options.pluginId}" respond failed for "${verb}": ${body.error ?? "unknown error"}`,
			);
		}
		return body.reply ?? "";
	};
}
