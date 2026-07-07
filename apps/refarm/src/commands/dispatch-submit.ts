import type { SubmitEffort } from "@refarm.dev/capabilities-v1";

import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";
import { sidecarUrl } from "./sidecar-url.js";

/**
 * The app's submit PLUMBING for a plugin dispatch effort — the sidecar HTTP sink.
 * The pure effort builder + the SubmitEffort type + DispatchRequest now live in
 * `@refarm.dev/capabilities-v1` (the plugin bridge); this file keeps only the host
 * transport (how THIS app reaches its runtime) and re-exports the pure pieces so
 * existing app consumers import them from here unchanged.
 *
 * The sidecar routes a non-`respond` fn to the target plugin via the neutral event
 * router (as `<pluginKey>:dispatch`). The async result lands as a dispatch-result:v1
 * node keyed by the effort id (== the replyRef).
 */

export {
	buildDispatchEffort,
	type DispatchRequest,
	type SubmitEffort,
} from "@refarm.dev/capabilities-v1";

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
