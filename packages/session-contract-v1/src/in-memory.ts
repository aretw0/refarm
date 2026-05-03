import type {
	Session,
	SessionContractAdapter,
	SessionEntry,
	SessionFilter,
} from "./types.js";

export interface InMemorySessionAdapterOptions {
	idFactory?: () => string;
	nowNs?: () => number;
}

function defaultIdFactory(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultNowNs(): number {
	// Keep timestamp arithmetic within Number.MAX_SAFE_INTEGER precision.
	return Date.now() * 1_000;
}

function nextNs(nowNs: () => number, previous?: number): number {
	const current = nowNs();
	if (previous === undefined) {
		return current;
	}
	return current > previous ? current : previous + 1;
}

function includesAllParticipants(
	sessionParticipants: string[],
	filterParticipants: string[],
): boolean {
	return filterParticipants.every((participant) =>
		sessionParticipants.includes(participant),
	);
}

function applySessionFilter(
	sessions: Session[],
	filter: SessionFilter,
): Session[] {
	let items = sessions;

	if (filter.context_id !== undefined) {
		items = items.filter((session) => session.context_id === filter.context_id);
	}

	if (filter.participants !== undefined && filter.participants.length > 0) {
		items = items.filter((session) =>
			includesAllParticipants(session.participants, filter.participants ?? []),
		);
	}

	return items;
}

export function createInMemorySessionAdapter(
	options: InMemorySessionAdapterOptions = {},
): SessionContractAdapter {
	const idFactory = options.idFactory ?? defaultIdFactory;
	const nowNs = options.nowNs ?? defaultNowNs;
	const sessions = new Map<string, Session>();
	const entriesBySession = new Map<string, SessionEntry[]>();
	let lastNs = 0;

	function issueNs(): number {
		lastNs = nextNs(nowNs, lastNs);
		return lastNs;
	}

	return {
		async create(sessionInput) {
			const session: Session = {
				...sessionInput,
				"@type": "Session",
				"@id": `urn:refarm:session:v1:${idFactory()}`,
				created_at_ns: issueNs(),
			};
			sessions.set(session["@id"], session);
			return session;
		},

		async get(id) {
			return sessions.get(id) ?? null;
		},

		async update(id, patch) {
			const current = sessions.get(id);
			if (!current) {
				throw new Error(`Session not found: ${id}`);
			}

			const updated: Session = {
				...current,
				...patch,
				"@type": "Session",
				"@id": current["@id"],
				created_at_ns: current.created_at_ns,
			};
			sessions.set(id, updated);
			return updated;
		},

		async appendEntry(entryInput) {
			if (!sessions.has(entryInput.session_id)) {
				throw new Error(
					`Session not found for entry append: ${entryInput.session_id}`,
				);
			}

			const entry: SessionEntry = {
				...entryInput,
				"@type": "SessionEntry",
				"@id": `urn:refarm:session-entry:v1:${idFactory()}`,
				timestamp_ns: issueNs(),
			};
			const entries = entriesBySession.get(entry.session_id) ?? [];
			entries.push(entry);
			entriesBySession.set(entry.session_id, entries);
			return entry;
		},

		async entries(sessionId, limit) {
			const entries = [...(entriesBySession.get(sessionId) ?? [])].sort(
				(a, b) => a.timestamp_ns - b.timestamp_ns,
			);
			if (limit === undefined || limit <= 0 || limit >= entries.length) {
				return entries;
			}

			return entries.slice(entries.length - limit);
		},

		async query(filter) {
			const all = Array.from(sessions.values()).sort(
				(a, b) => a.created_at_ns - b.created_at_ns,
			);
			return applySessionFilter(all, filter);
		},
	};
}
