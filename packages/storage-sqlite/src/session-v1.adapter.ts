import type {
	Session,
	SessionContractAdapter,
	SessionEntry,
	SessionFilter,
} from "@refarm.dev/session-contract-v1";
import type {
	StorageProvider,
	StorageRecord,
} from "@refarm.dev/storage-contract-v1";


const SESSION_RECORD_TYPE = "Session";
const SESSION_ENTRY_RECORD_TYPE = "SessionEntry";

export interface StorageSessionV1AdapterOptions {
	provider?: StorageProvider;
	idFactory?: () => string;
	nowNs?: () => number;
}

function defaultIdFactory(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultNowNs(): number {
	// Keep monotonic arithmetic under Number.MAX_SAFE_INTEGER.
	return Date.now() * 1_000;
}

function nextNs(nowNs: () => number, previous?: number): number {
	const current = nowNs();
	if (previous === undefined) return current;
	return current > previous ? current : previous + 1;
}

function parsePayload<T>(record: StorageRecord | null): T | null {
	if (!record) return null;
	try {
		return JSON.parse(record.payload) as T;
	} catch {
		return null;
	}
}

function asSession(value: unknown): Session | null {
	if (!value || typeof value !== "object") return null;
	const session = value as Session;
	if (
		session["@type"] !== "Session" ||
		typeof session["@id"] !== "string" ||
		!Array.isArray(session.participants)
	) {
		return null;
	}
	return session;
}

function asSessionEntry(value: unknown): SessionEntry | null {
	if (!value || typeof value !== "object") return null;
	const entry = value as SessionEntry;
	if (
		entry["@type"] !== "SessionEntry" ||
		typeof entry["@id"] !== "string" ||
		typeof entry.session_id !== "string"
	) {
		return null;
	}
	return entry;
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
	let filtered = sessions;

	if (filter.context_id !== undefined) {
		filtered = filtered.filter(
			(session) => session.context_id === filter.context_id,
		);
	}

	if (filter.participants !== undefined && filter.participants.length > 0) {
		filtered = filtered.filter((session) =>
			includesAllParticipants(session.participants, filter.participants ?? []),
		);
	}

	return filtered;
}

function createFallbackStorageProvider(): StorageProvider {
	const rows = new Map<string, StorageRecord>();
	return {
		pluginId: "@refarm.dev/storage-sqlite/session-v1-fallback",
		capability: "storage:v1",
		async get(id) {
			return rows.get(id) ?? null;
		},
		async put(record) {
			rows.set(record.id, record);
		},
		async delete(id) {
			rows.delete(id);
		},
		async query(query) {
			let values = [...rows.values()];
			if (query.type) values = values.filter((row) => row.type === query.type);
			const offset = query.offset ?? 0;
			const limit = query.limit ?? values.length;
			return values.slice(offset, offset + limit);
		},
	};
}

export function createSessionV1StorageAdapter(
	options: StorageSessionV1AdapterOptions = {},
): SessionContractAdapter {
	const provider = options.provider ?? createFallbackStorageProvider();
	const idFactory = options.idFactory ?? defaultIdFactory;
	const nowNs = options.nowNs ?? defaultNowNs;
	let lastNs = 0;

	function issueNs(): number {
		lastNs = nextNs(nowNs, lastNs);
		return lastNs;
	}

	async function readSession(
		id: string,
	): Promise<{ record: StorageRecord; session: Session } | null> {
		const record = await provider.get(id);
		if (!record || record.type !== SESSION_RECORD_TYPE) return null;
		const session = asSession(parsePayload<Session>(record));
		if (!session) return null;
		return { record, session };
	}

	return {
		async create(sessionInput) {
			const session: Session = {
				...sessionInput,
				"@type": "Session",
				"@id": `urn:refarm:session:v1:${idFactory()}`,
				created_at_ns: issueNs(),
			};
			const nowIso = new Date().toISOString();
			await provider.put({
				id: session["@id"],
				type: SESSION_RECORD_TYPE,
				payload: JSON.stringify(session),
				createdAt: nowIso,
				updatedAt: nowIso,
			});
			return session;
		},

		async get(id) {
			return (await readSession(id))?.session ?? null;
		},

		async update(id, patch) {
			const current = await readSession(id);
			if (!current) throw new Error(`Session not found: ${id}`);
			const updated: Session = {
				...current.session,
				...patch,
				"@type": "Session",
				"@id": current.session["@id"],
				created_at_ns: current.session.created_at_ns,
			};
			await provider.put({
				...current.record,
				payload: JSON.stringify(updated),
				updatedAt: new Date().toISOString(),
			});
			return updated;
		},

		async appendEntry(entryInput) {
			const session = await readSession(entryInput.session_id);
			if (!session) {
				throw new Error(
					`Session not found for appendEntry: ${entryInput.session_id}`,
				);
			}
			const entry: SessionEntry = {
				...entryInput,
				"@type": "SessionEntry",
				"@id": `urn:refarm:session-entry:v1:${idFactory()}`,
				timestamp_ns: issueNs(),
			};
			const nowIso = new Date().toISOString();
			await provider.put({
				id: entry["@id"],
				type: SESSION_ENTRY_RECORD_TYPE,
				payload: JSON.stringify(entry),
				createdAt: nowIso,
				updatedAt: nowIso,
			});
			return entry;
		},

		async entries(sessionId, limit) {
			const records = await provider.query({ type: SESSION_ENTRY_RECORD_TYPE });
			const entries = records
				.map((record) => asSessionEntry(parsePayload<SessionEntry>(record)))
				.filter((entry): entry is SessionEntry => Boolean(entry))
				.filter((entry) => entry.session_id === sessionId)
				.sort((a, b) => a.timestamp_ns - b.timestamp_ns);
			if (limit === undefined || limit <= 0 || limit >= entries.length) {
				return entries;
			}
			return entries.slice(entries.length - limit);
		},

		async query(filter) {
			const records = await provider.query({ type: SESSION_RECORD_TYPE });
			const sessions = records
				.map((record) => asSession(parsePayload<Session>(record)))
				.filter((session): session is Session => Boolean(session))
				.sort((a, b) => a.created_at_ns - b.created_at_ns);
			return applySessionFilter(sessions, filter);
		},
	};
}
