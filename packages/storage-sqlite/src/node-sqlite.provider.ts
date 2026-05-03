import { DatabaseSync } from "node:sqlite";
import {
	STORAGE_CAPABILITY,
	type StorageProvider,
	type StorageQuery,
	type StorageRecord,
} from "@refarm.dev/storage-contract-v1";

const DDL = `
  CREATE TABLE IF NOT EXISTS storage_records (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_storage_records_type ON storage_records(type);
`;

interface RawRow {
	id: string;
	type: string;
	payload: string;
	created_at: string;
	updated_at: string;
}

function toRecord(row: RawRow): StorageRecord {
	return {
		id: row.id,
		type: row.type,
		payload: row.payload,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export class NodeSqliteStorageProvider implements StorageProvider {
	readonly pluginId = "@refarm.dev/storage-sqlite/node";
	readonly capability = STORAGE_CAPABILITY;

	private readonly db: DatabaseSync;

	constructor(dbPath: string) {
		this.db = new DatabaseSync(dbPath);
		this.db.exec(DDL);
	}

	async get(id: string): Promise<StorageRecord | null> {
		const row = this.db
			.prepare("SELECT * FROM storage_records WHERE id = ?")
			.get(id) as unknown as RawRow | undefined;
		return row ? toRecord(row) : null;
	}

	async put(record: StorageRecord): Promise<void> {
		this.db
			.prepare(
				`INSERT INTO storage_records (id, type, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type       = excluded.type,
           payload    = excluded.payload,
           updated_at = excluded.updated_at`,
			)
			.run(
				record.id,
				record.type,
				record.payload,
				record.createdAt,
				record.updatedAt,
			);
	}

	async delete(id: string): Promise<void> {
		this.db
			.prepare("DELETE FROM storage_records WHERE id = ?")
			.run(id);
	}

	async query(query: StorageQuery): Promise<StorageRecord[]> {
		const hasType = query.type !== undefined;
		const sql = `SELECT * FROM storage_records${hasType ? " WHERE type = ?" : ""} ORDER BY created_at ASC LIMIT ? OFFSET ?`;
		const params: (string | number)[] = [];
		if (hasType) params.push(query.type as string);
		params.push(query.limit ?? -1);
		params.push(query.offset ?? 0);
		const rows = this.db.prepare(sql).all(...params) as unknown as RawRow[];
		return rows.map(toRecord);
	}

	close(): void {
		this.db.close();
	}
}

export function createNodeSqliteStorageProvider(
	dbPath: string,
): StorageProvider {
	return new NodeSqliteStorageProvider(dbPath);
}
