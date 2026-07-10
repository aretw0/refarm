import { DatabaseSync } from "node:sqlite";
import {
	STORAGE_CAPABILITY,
	type StorageProvider,
	type StorageQuery,
	type StorageRecord,
} from "@refarm.dev/storage-contract-v1";

interface NodeRow {
	id: string;
	type: string;
	payload: string;
	updated_at: string;
}

/**
 * READ-ONLY view over the tractor host's materialised `nodes` table
 * (`~/.local/share/refarm/{namespace}.db`). The Rust host writes the sovereign
 * graph (RefarmConfig, Session, Response, …) here via `store_node`; this provider
 * lets a TS process (e.g. `refarm health` auditing the config node) read those
 * nodes WITHOUT a running sidecar — it is a plain file open, exactly like the
 * host's own `NativeStorage::open_at` of a pre-existing db.
 *
 * Opened with `{ readOnly: true }`: writes are rejected by SQLite and a missing
 * file throws (never created), so this can never create or mutate the host db.
 * Distinct from {@link NodeSqliteStorageProvider}, which owns its own
 * `storage_records` table — this reads the host-owned `nodes` table and mutates
 * nothing.
 */
export class TractorNodesReadProvider implements StorageProvider {
	readonly pluginId = "@refarm.dev/storage-sqlite/tractor-nodes-read";
	readonly capability = STORAGE_CAPABILITY;
	private readonly db: DatabaseSync;

	constructor(dbPath: string) {
		// readOnly: rejects any write and does NOT create the file if absent.
		this.db = new DatabaseSync(dbPath, { readOnly: true });
	}

	async get(id: string): Promise<StorageRecord | null> {
		const row = this.db
			.prepare("SELECT id, type, payload, updated_at FROM nodes WHERE id = ?")
			.get(id) as unknown as NodeRow | undefined;
		return row ? this.toRecord(row) : null;
	}

	async query(query: StorageQuery): Promise<StorageRecord[]> {
		const hasType = typeof query.type === "string" && query.type.length > 0;
		const sql = `SELECT id, type, payload, updated_at FROM nodes${
			hasType ? " WHERE type = ?" : ""
		} ORDER BY updated_at ASC`;
		const stmt = this.db.prepare(sql);
		const rows = (hasType ? stmt.all(query.type as string) : stmt.all()) as unknown as NodeRow[];
		return rows.map((row) => this.toRecord(row));
	}

	async put(): Promise<void> {
		throw new Error("TractorNodesReadProvider is read-only: put() not allowed");
	}

	async putMany(): Promise<void> {
		throw new Error("TractorNodesReadProvider is read-only: putMany() not allowed");
	}

	async delete(): Promise<void> {
		throw new Error("TractorNodesReadProvider is read-only: delete() not allowed");
	}

	async deleteMany(): Promise<void> {
		throw new Error("TractorNodesReadProvider is read-only: deleteMany() not allowed");
	}

	close(): void {
		this.db.close();
	}

	private toRecord(row: NodeRow): StorageRecord {
		// The host has no separate created_at column on `nodes`; use updated_at for
		// both so the StorageRecord shape is satisfied. NodeView only reads payload.
		return {
			id: row.id,
			type: row.type,
			payload: row.payload,
			createdAt: row.updated_at,
			updatedAt: row.updated_at,
		};
	}
}
