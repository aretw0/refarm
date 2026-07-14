/**
 * Shared helpers for the T1 live-runtime verbs (agent-run / delegate-run / code-ops).
 * These verbs each boot a tractor daemon and dispatch to a plugin; the DISPATCH-RESULT
 * read-back was copy-pasted byte-for-byte across delegate-run and code-ops, which is
 * exactly where a fix lands in one and not the other. Centralised here so all live verbs
 * share one implementation.
 */

/**
 * Poll `GET /nodes?type=DispatchResult` for the node correlated by `replyRef`. A
 * dispatch effort finalises as `delivered` (not `done`) — the verb result lands
 * asynchronously as a DispatchResult node the caller reads back by replyRef. Returns
 * the node, or undefined on timeout.
 *
 * NOTE: this reads the graph, so the daemon MUST run with a file-backed namespace (not
 * `:memory:`, where each NativeStorage::open opens a SEPARATE store and the plugin's
 * written node is invisible here). agent-run does NOT use this — it reads the agent's
 * response from the `/efforts` response body directly, so it can stay on `:memory:`.
 */
export async function awaitDispatchResult(
	sidecarBaseUrl: string,
	replyRef: string,
	timeoutMs: number,
): Promise<Record<string, unknown> | undefined> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const res = await fetch(`${sidecarBaseUrl}/nodes?type=DispatchResult`);
		if (res.ok) {
			// The sidecar wraps the list: { nodes: [...], total }.
			const body = (await res.json()) as { nodes?: Array<Record<string, unknown>> };
			const nodes = Array.isArray(body.nodes) ? body.nodes : [];
			const match = nodes.find((n) => n.replyRef === replyRef);
			if (match) return match;
		}
		await new Promise((r) => setTimeout(r, 150));
	}
	return undefined;
}
