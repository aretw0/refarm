import {
	STORAGE_CAPABILITY,
	type StorageProvider,
	type StorageQuery,
	type StorageRecord,
} from "@refarm.dev/storage-contract-v1";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Filesystem-backed StorageProvider — the Node-side bootstrap primitive.
 *
 * WHY THIS EXISTS (bootstrap, not a plugin): loading any plugin already
 * requires persisting bytes and records, so the first persistence backend
 * cannot itself be a plugin — it would be circular. `storage-fs` is the ground
 * a plugin stands on. Additional backends (sqlite, rest, p2p, s3…) CAN be
 * plugins because by the time they load, this contract and this backend
 * already exist. The host guarantees the contract + a bootstrap backend; a
 * plugin only intends persistence (`put`/`get`) and never implements the
 * mechanism. See docs/EXTENSIBILITY_MODEL.md ("Persistence & the bootstrap
 * boundary").
 *
 * SHAPE: one JSON file per store, holding a map of `id → record`. Writes are
 * atomic (sibling temp file + rename over the target), mirroring the pattern
 * proven in packages/windmill/src/local-scheduler-ledger.js so a crash
 * mid-write can never leave a half-written ledger. Directory `0700`, file
 * `0600` — a ledger may hold config/secrets-adjacent data.
 *
 * SCOPE: this is a *ledger* store (install records, config overrides,
 * scheduler entries, registry state) — modest record counts held in memory
 * and rewritten whole on each mutation. It is deliberately NOT a database:
 * for large or high-churn datasets, use storage-sqlite. Concurrent writers to
 * the same file race last-write-wins (acceptable for a single local host that
 * mutates sequentially; a multi-writer setup would need file locking).
 */

const LEDGER_DIRECTORY_MODE = 0o700;
const LEDGER_FILE_MODE = 0o600;

interface StoreShape {
	records: Record<string, StorageRecord>;
}

function emptyStore(): StoreShape {
	return { records: {} };
}

async function readStore(filePath: string): Promise<StoreShape> {
	let raw: string;
	try {
		raw = await readFile(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return emptyStore();
		}
		throw error;
	}
	const trimmed = raw.trim();
	if (trimmed === "") return emptyStore();
	const parsed = JSON.parse(trimmed) as Partial<StoreShape>;
	return { records: parsed.records ?? {} };
}

async function writeStore(filePath: string, store: StoreShape): Promise<void> {
	// Atomic replace: write a sibling temp file, then rename over the target so
	// a crash mid-write can never leave a half-written store. See
	// packages/windmill/src/local-scheduler-ledger.js for the precedent.
	await mkdir(dirname(filePath), {
		recursive: true,
		mode: LEDGER_DIRECTORY_MODE,
	});
	// process.pid + a monotonic counter keep temp names unique without relying
	// on Date.now()/Math.random() (kept deterministic-friendly).
	const tempPath = `${filePath}.${process.pid}.${nextTempTicket()}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(store, null, "\t")}\n`, {
		encoding: "utf8",
		mode: LEDGER_FILE_MODE,
	});
	await rename(tempPath, filePath);
}

let tempCounter = 0;
function nextTempTicket(): number {
	tempCounter += 1;
	return tempCounter;
}

function matchesQuery(record: StorageRecord, query: StorageQuery): boolean {
	if (query.type !== undefined && record.type !== query.type) return false;
	if (
		query.createdAfter !== undefined &&
		!(record.createdAt > query.createdAfter)
	) {
		return false;
	}
	if (
		query.createdBefore !== undefined &&
		!(record.createdAt < query.createdBefore)
	) {
		return false;
	}
	return true;
}

export class NodeFsStorageProvider implements StorageProvider {
	readonly pluginId = "@refarm.dev/storage-fs/node";
	readonly capability = STORAGE_CAPABILITY;

	private readonly filePath: string;

	/**
	 * @param filePath absolute path to the JSON store file (e.g.
	 *   `<scope>/.refarm/barn/ledger.json`). The host injects the scope
	 *   (user home vs workspace); the provider is agnostic to it.
	 */
	constructor(filePath: string) {
		this.filePath = filePath;
	}

	async get(id: string): Promise<StorageRecord | null> {
		const store = await readStore(this.filePath);
		return store.records[id] ?? null;
	}

	async put(record: StorageRecord): Promise<void> {
		const store = await readStore(this.filePath);
		store.records[record.id] = record;
		await writeStore(this.filePath, store);
	}

	async putMany(records: StorageRecord[]): Promise<void> {
		if (records.length === 0) return;
		const store = await readStore(this.filePath);
		for (const record of records) {
			store.records[record.id] = record;
		}
		await writeStore(this.filePath, store);
	}

	async delete(id: string): Promise<void> {
		const store = await readStore(this.filePath);
		if (!(id in store.records)) return;
		delete store.records[id];
		await writeStore(this.filePath, store);
	}

	async deleteMany(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const store = await readStore(this.filePath);
		let changed = false;
		for (const id of ids) {
			if (id in store.records) {
				delete store.records[id];
				changed = true;
			}
		}
		if (changed) await writeStore(this.filePath, store);
	}

	async query(query: StorageQuery): Promise<StorageRecord[]> {
		const store = await readStore(this.filePath);
		const matched = Object.values(store.records)
			.filter((record) => matchesQuery(record, query))
			.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
		const offset = query.offset ?? 0;
		const end = query.limit !== undefined ? offset + query.limit : undefined;
		return matched.slice(offset, end);
	}
}

/**
 * Create a filesystem StorageProvider backed by a single JSON store file.
 *
 * The host is responsible for resolving `filePath` from the intended scope
 * (e.g. `~/.refarm/...` for user scope, `./.refarm/...` for workspace scope);
 * this factory stays scope-agnostic so the same code serves every host.
 */
export function createNodeFsStorageProvider(filePath: string): StorageProvider {
	return new NodeFsStorageProvider(filePath);
}
