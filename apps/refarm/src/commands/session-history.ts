import type { OperatorResumeSessionRecord } from "@refarm.dev/cli/operator-resume";
import { refarmCommand } from "@refarm.dev/cli/command-handoff";
import { formatSessionId } from "./session-ids.js";
import { sessionParticipantFields } from "./session-participants.js";
import { fetchSidecarWithTimeout } from "./sidecar-fetch.js";
import { sidecarUrl } from "./sidecar-url.js";

interface RuntimeSessionNode {
	"@id": string;
	name?: string;
	created_at_ns?: number;
	leaf_entry_id?: string | null;
	participants?: string[];
}

const RECENT_SESSION_TIMEOUT_MS = 300;
const REFARM_RECENT_SESSION_TIMEOUT_MS = "REFARM_RECENT_SESSION_TIMEOUT_MS";

export async function loadRecentRuntimeSessions(options: {
	limit?: number;
	timeoutMs?: number;
} = {}): Promise<OperatorResumeSessionRecord[]> {
	const limit = options.limit ?? 5;
	try {
		const response = await fetchSidecarWithTimeout(sidecarUrl("/sessions"), {}, {
			timeoutEnvVar: REFARM_RECENT_SESSION_TIMEOUT_MS,
			defaultTimeoutMs: RECENT_SESSION_TIMEOUT_MS,
			timeoutMs: options.timeoutMs,
		});
		if (!response.ok) return [];
		const body = (await response.json()) as { sessions?: RuntimeSessionNode[] };
		return normalizeRuntimeSessions(body.sessions ?? []).slice(0, limit);
	} catch {
		return [];
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
				...sessionParticipantFields(session.participants),
				showCommand: refarmCommand(["sessions", "show", shortId, "--json"]),
				useCommand: refarmCommand(["sessions", "use", shortId, "--json"]),
			};
		});
}
