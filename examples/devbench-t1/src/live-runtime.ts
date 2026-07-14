/**
 * Shared helpers for the T1 live-runtime verbs (agent-run / delegate-run / code-ops / audit /
 * enforce / telemetry). These verbs each boot a tractor daemon and dispatch to a plugin; the
 * DISPATCH-RESULT read-back and the audit-trail wait were copy-pasted (or slept-for) across verbs,
 * which is exactly where a fix lands in one and not the other. Centralised here so all live verbs
 * share one implementation.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One parsed audit line — the merged event payload the host wrote (`{ ts, event, plugin_id?,
 * ...payload }`). Both `host-effect:*` and `agent:*` families land in the SAME file, so a reader
 * that wants the full run (not one family) reads all lines. */
export interface AuditTrailLine {
	event: string;
	ts?: number;
	plugin_id?: string;
	prompt_ref?: string;
	[k: string]: unknown;
}

/**
 * Read ALL parsed lines from `{refarmDir}/scarecrow-audit.ndjson` — both `host-effect:*` and
 * `agent:*` families, unfiltered, so a caller can wait on any event or build a unified run trace.
 * PURE (of everything but the one file read).
 */
export function readAuditLines(refarmDir: string): AuditTrailLine[] {
	const path = join(refarmDir, "scarecrow-audit.ndjson");
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf-8")
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line) as AuditTrailLine;
			} catch {
				return undefined;
			}
		})
		.filter((l): l is AuditTrailLine => l !== undefined && typeof l.event === "string");
}

/**
 * Poll the audit trail until `predicate` matches a line (returning that line) or `timeoutMs`
 * elapses (returning undefined). Replaces the fixed `setTimeout` sleeps that raced the event
 * flush — a slow runner no longer reads a partial/empty trail. Same poll shape as
 * awaitDispatchResult (150ms tick). When the awaited line will genuinely never appear (the DENIED
 * enforce posture), the caller still gets a bounded wait then reads the final state — correct and
 * faster than a blind sleep.
 */
export async function awaitAuditLine(
	refarmDir: string,
	predicate: (line: AuditTrailLine) => boolean,
	timeoutMs: number,
): Promise<AuditTrailLine | undefined> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const match = readAuditLines(refarmDir).find(predicate);
		if (match) return match;
		await new Promise((r) => setTimeout(r, 150));
	}
	return undefined;
}

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
