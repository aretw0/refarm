import type { Effort } from "@refarm.dev/effort-contract-v1";

import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";
import { sidecarUrl } from "./sidecar-url.js";

/**
 * The neutral submit path for a plugin dispatch effort — shared by the generic
 * `refarm dispatch` command and any per-plugin dispatch action (vault, quality,
 * …). Builds the one-task Effort and submits it to the runtime sidecar's
 * `POST /efforts`; the sidecar routes a non-`respond` fn to the target plugin via
 * the neutral event router (as `<pluginKey>:dispatch`). The async result lands as
 * a dispatch-result:v1 node keyed by the effort id (== the replyRef).
 */

/** Submit an effort to the runtime sidecar, returning its id. Injectable so a
 * command's run() stays testable without a running daemon. */
export type SubmitEffort = (effort: Effort) => Promise<string>;

/** The default sink: `POST /efforts` on the sidecar (mirrors `refarm ask`). */
export const submitEffortViaSidecar: SubmitEffort = async (effort) => {
	const response = await fetchSidecarWithTimeout(sidecarUrl("/efforts"), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(effort),
	});
	if (!response.ok) {
		throw new Error(`runtime HTTP ${response.status}`);
	}
	const payload = (await response.json()) as { effortId: string };
	return payload.effortId;
};

/** The inputs a dispatch needs, independent of any one plugin. */
export interface DispatchRequest {
	/** The target plugin id (e.g. `vault`, `quality`) — the sidecar derives the
	 * event `<pluginKey>:dispatch` from it. */
	pluginId: string;
	/** The verb (the effort's fn) the plugin's on-event handler runs. */
	verb: string;
	/** The verb's domain args (note+profile, subject+profile, …). `replyRef` is
	 * injected here, so a caller passes only the domain input. */
	args: Record<string, unknown>;
}

/** Build the one-task Effort for a dispatch. `replyRef` (== the effort id) is
 * stamped into the args so the plugin correlates its dispatch-result node back. */
export function buildDispatchEffort(
	request: DispatchRequest,
	newId: () => string,
	nowIso: () => string,
): Effort {
	const effortId = newId();
	return {
		id: effortId,
		direction: "dispatch",
		tasks: [
			{
				id: newId(),
				pluginId: request.pluginId,
				fn: request.verb,
				args: { ...request.args, replyRef: effortId },
			},
		],
		source: "refarm-dispatch",
		submittedAt: nowIso(),
	};
}
