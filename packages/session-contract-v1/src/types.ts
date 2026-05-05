export const SESSION_CAPABILITY = "session:v1" as const;

export type SessionEntryKind =
	| "user"
	| "agent"
	| "tool_call"
	| "tool_result"
	| "system";

export interface Session {
	"@type": "Session";
	"@id": string;
	participants: string[];
	context_id: string | null;
	created_at_ns: number;
}

export interface SessionEntry {
	"@type": "SessionEntry";
	"@id": string;
	session_id: string;
	parent_entry_id: string | null;
	kind: SessionEntryKind;
	content: string;
	timestamp_ns: number;
}

export interface SessionFilter {
	participants?: string[];
	context_id?: string;
}

export interface SessionConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}

export interface SessionContractAdapter {
	create(session: Omit<Session, "@id" | "created_at_ns">): Promise<Session>;
	get(id: string): Promise<Session | null>;
	update(
		id: string,
		patch: Partial<Omit<Session, "@id" | "@type">>,
	): Promise<Session>;
	appendEntry(
		entry: Omit<SessionEntry, "@id" | "timestamp_ns">,
	): Promise<SessionEntry>;
	entries?(sessionId: string, limit?: number): Promise<SessionEntry[]>;
	query?(filter: SessionFilter): Promise<Session[]>;
}
