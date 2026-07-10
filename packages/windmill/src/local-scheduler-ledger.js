import { openScopedLedger, scopedLedgerPath } from "@refarm.dev/storage-node-view";

export const LOCAL_SCHEDULER_LEDGER_SCHEMA = "refarm.local-scheduler-ledger.v1";
export const DEFAULT_LOCAL_SCHEDULER_LEDGER_PATH = ".refarm/scheduler/ledger.json";

// The ledger is a durable node-ledger opened via the host bootstrap
// (openScopedLedger): each fired-schedule key is a node, so hasFired/recordFired
// are getNode/storeNode over the shared fs StorageProvider — the same atomic
// temp+rename write and owner-only .refarm/ modes, now inherited instead of
// hand-rolled. `read()` reassembles the aggregate {entries} view from the nodes.
const LEDGER_NAME = "scheduler";
const LEDGER_SCOPE = "workspace";
const FIRED_NODE_TYPE = "refarm:scheduler-fired";

function assertNonEmptyString(value, name) {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new TypeError(`${name} must be a non-empty string`);
	}
	return value;
}

/** Map a `{ cwd, filePath? }` options object to openScopedLedger options. */
function ledgerOptions(options = {}) {
	const cwd = options.cwd ?? process.cwd();
	assertNonEmptyString(cwd, "cwd");
	// An explicit absolute filePath opts out of scope resolution (the fs provider
	// returns an absolute path as-is); otherwise the workspace scope resolves it
	// under `<cwd>/.refarm/scheduler/ledger.json`.
	if (options.filePath !== undefined) {
		assertNonEmptyString(options.filePath, "filePath");
		return { workspaceRoot: cwd, storeFile: options.filePath };
	}
	return { workspaceRoot: cwd };
}

/** Wrap the node store so a malformed backing file rejects with the domain
 * message the callers expect — rejecting is the whole point (never silently
 * re-fire the world), so a corrupt file must throw, not read as empty. */
async function guardMalformed(filePath, read) {
	try {
		return await read();
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`Invalid local scheduler ledger at ${filePath}: ${error.message}`);
		}
		throw error;
	}
}

/** Project a fired-key node back into the receipt shape callers stored. Strip
 * the whole node envelope (@id/@type/@context + the record⇄node timestamps the
 * bridge adds) so an entry carries only `recordedAt` + the caller's receipt —
 * the same shape the pre-migration ledger exposed. */
function nodeToEntry(node) {
	const {
		"@id": _id,
		"@type": _type,
		"@context": _context,
		"refarm:createdAt": _createdAt,
		"refarm:updatedAt": _updatedAt,
		...entry
	} = node;
	return entry;
}

export function resolveLocalSchedulerLedgerPath(options = {}) {
	return scopedLedgerPath(LEDGER_NAME, LEDGER_SCOPE, ledgerOptions(options));
}

export async function readLocalSchedulerLedger(options = {}) {
	return createLocalSchedulerLedger(options).read();
}

export function createLocalSchedulerLedger(options = {}) {
	const opts = ledgerOptions(options);
	const filePath = scopedLedgerPath(LEDGER_NAME, LEDGER_SCOPE, opts);
	const store = openScopedLedger(LEDGER_NAME, LEDGER_SCOPE, opts);
	return {
		filePath,
		async hasFired(key) {
			assertNonEmptyString(key, "key");
			const node = await guardMalformed(filePath, () => store.getNode(key));
			return node !== null;
		},
		async recordFired(key, receipt) {
			assertNonEmptyString(key, "key");
			const now = new Date().toISOString();
			await store.storeNode({
				"@id": key,
				"@type": FIRED_NODE_TYPE,
				recordedAt: now,
				...receipt,
			});
		},
		async read() {
			const nodes = await guardMalformed(filePath, () => store.queryNodes(FIRED_NODE_TYPE));
			const entries = {};
			let updatedAt = null;
			for (const node of nodes) {
				const entry = nodeToEntry(node);
				entries[node["@id"]] = entry;
				if (entry.recordedAt && (updatedAt === null || entry.recordedAt > updatedAt)) {
					updatedAt = entry.recordedAt;
				}
			}
			return {
				schema: LOCAL_SCHEDULER_LEDGER_SCHEMA,
				schemaVersion: 1,
				updatedAt,
				entries,
			};
		},
	};
}
