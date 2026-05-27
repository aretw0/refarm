import type { OperatorResumeSessionRecord } from "@refarm.dev/cli/operator-resume";
import { refarmCommand } from "./command-handoff.js";
import { formatSessionId } from "./session-ids.js";
import { sidecarUrl } from "./sidecar-url.js";

interface RuntimeSessionNode {
	"@id": string;
	name?: string;
	created_at_ns?: number;
	leaf_entry_id?: string | null;
}

const RECENT_SESSION_TIMEOUT_MS = 300;

export async function loadRecentRuntimeSessions(options: {
	limit?: number;
	timeoutMs?: number;
} = {}): Promise<OperatorResumeSessionRecord[]> {
	const limit = options.limit ?? 5;
	const timeoutMs = options.timeoutMs ?? RECENT_SESSION_TIMEOUT_MS;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const controller = new AbortController();
		timer = setTimeout(() => controller.abort(), timeoutMs);
		const response = await fetch(sidecarUrl("/sessions"), {
			signal: controller.signal,
		});
		if (!response.ok) return [];
		const body = (await response.json()) as { sessions?: RuntimeSessionNode[] };
		return normalizeRuntimeSessions(body.sessions ?? []).slice(0, limit);
	} catch {
		return [];
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function normalizeRuntimeSessions(
	sessions: readonly RuntimeSessionNode[],
): OperatorResumeSessionRecord[] {
	return [...sessions]
		.sort((a, b) => (b.created_at_ns ?? 0) - (a.created_at_ns ?? 0))
		.map((session) => {
			const shortId = formatSessionId(session["@id"]);
			return {
				sessionId: session["@id"],
				shortId,
				name: session.name ?? null,
				createdAtNs: session.created_at_ns ?? null,
				hasHistory: Boolean(session.leaf_entry_id),
				showCommand: refarmCommand(["sessions", "show", shortId, "--json"]),
				useCommand: refarmCommand(["sessions", "use", shortId, "--json"]),
			};
		});
}
