import {
	runStorageV1Conformance,
	STORAGE_CAPABILITY,
	type StorageProvider,
	type StorageQuery,
	type StorageRecord,
} from "@refarm.dev/storage-contract-v1";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RestStorageAdapter } from "./rest-storage-adapter.js";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function noContentResponse(): Response {
	return new Response(null, { status: 204 });
}

function installStorageRestMock(): void {
	const rows = new Map<string, StorageRecord>();

	vi.spyOn(globalThis, "fetch").mockImplementation(
		async (url: RequestInfo | URL, init?: RequestInit) => {
			const requestUrl = new URL(url.toString());

			if (requestUrl.pathname === "/nodes" && init?.method === "POST") {
				const body = JSON.parse(String(init.body ?? "{}")) as {
					id?: string;
					type?: string;
					payload?: string;
				};

				if (!body.id || !body.type || typeof body.payload !== "string") {
					return new Response(null, { status: 400 });
				}

				const now = new Date().toISOString();
				const previous = rows.get(body.id);
				rows.set(body.id, {
					id: body.id,
					type: body.type,
					payload: body.payload,
					createdAt: previous?.createdAt ?? now,
					updatedAt: now,
				});

				return noContentResponse();
			}

			if (requestUrl.pathname === "/nodes") {
				const type = requestUrl.searchParams.get("type") ?? undefined;
				const filtered = [...rows.values()].filter((row) =>
					type ? row.type === type : true,
				);
				return jsonResponse(filtered);
			}

			if (requestUrl.pathname === "/sql" && init?.method === "POST") {
				const body = JSON.parse(String(init.body ?? "{}")) as {
					sql?: string;
					args?: unknown[];
				};

				const sql = String(body.sql ?? "")
					.trim()
					.toLowerCase();
				const args = Array.isArray(body.args) ? body.args : [];

				if (sql.startsWith("select") && sql.includes("where id = ?")) {
					const id = String(args[0] ?? "");
					const row = rows.get(id);
					return jsonResponse(row ? [row] : []);
				}

				if (
					sql.startsWith("delete from nodes") &&
					sql.includes("where id = ?")
				) {
					const id = String(args[0] ?? "");
					rows.delete(id);
					return jsonResponse([]);
				}

				return jsonResponse([]);
			}

			return new Response(null, { status: 404 });
		},
	);
}

class RestStorageV1Provider implements StorageProvider {
	readonly pluginId = "@refarm.dev/storage-rest";
	readonly capability = STORAGE_CAPABILITY;

	constructor(private readonly adapter: RestStorageAdapter) {}

	async get(id: string): Promise<StorageRecord | null> {
		const rows = (await this.adapter.execute(
			"SELECT id, type, payload, created_at AS createdAt, updated_at AS updatedAt FROM nodes WHERE id = ?",
			[id],
		)) as StorageRecord[];

		return rows[0] ?? null;
	}

	async put(record: StorageRecord): Promise<void> {
		await this.adapter.storeNode(
			record.id,
			record.type,
			"storage:v1",
			record.payload,
			this.pluginId,
		);
	}

	async delete(id: string): Promise<void> {
		await this.adapter.execute("DELETE FROM nodes WHERE id = ?", [id]);
	}

	async query(query: StorageQuery): Promise<StorageRecord[]> {
		const rows = await this.adapter.queryNodes(query.type ?? "");
		const normalized = rows
			.map((row) => normalizeStorageRecord(row))
			.filter((row): row is StorageRecord => row !== null);

		const offset = query.offset ?? 0;
		const limit = query.limit ?? normalized.length;
		return normalized.slice(offset, offset + limit);
	}
}

function normalizeStorageRecord(value: unknown): StorageRecord | null {
	if (!value || typeof value !== "object") return null;

	const row = value as Partial<StorageRecord>;
	if (!row.id || !row.type || typeof row.payload !== "string") return null;

	const now = new Date().toISOString();
	return {
		id: row.id,
		type: row.type,
		payload: row.payload,
		createdAt: row.createdAt ?? now,
		updatedAt: row.updatedAt ?? now,
	};
}

describe("@refarm.dev/storage-rest storage:v1 conformance", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("passes storage:v1 contract when SQL endpoint is enabled", async () => {
		installStorageRestMock();
		const provider = new RestStorageV1Provider(
			new RestStorageAdapter({
				baseUrl: "https://api.example.com",
				enableSql: true,
			}),
		);

		const result = await runStorageV1Conformance(provider);

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});

	it("reports contract failures when SQL endpoint is disabled", async () => {
		installStorageRestMock();
		const provider = new RestStorageV1Provider(
			new RestStorageAdapter({
				baseUrl: "https://api.example.com",
				enableSql: false,
			}),
		);

		const result = await runStorageV1Conformance(provider);

		expect(result.pass).toBe(false);
		expect(result.failures).toContain("get() returned null after put()");
	});
});
