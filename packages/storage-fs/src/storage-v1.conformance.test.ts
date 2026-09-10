import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runStorageV1Conformance } from "@refarm.dev/storage-contract-v1";

import { createNodeFsStorageProvider } from "./node-fs.provider.js";

describe("@refarm.dev/storage-fs storage:v1 conformance", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "refarm-storage-fs-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("passes storage:v1 contract", async () => {
		const provider = createNodeFsStorageProvider(join(dir, "store.json"));
		const result = await runStorageV1Conformance(provider);

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});

	it("creates the store file lazily and persists across provider instances", async () => {
		const filePath = join(dir, "nested", "ledger.json");
		const first = createNodeFsStorageProvider(filePath);
		await first.put({
			id: "a",
			type: "install-record",
			payload: JSON.stringify({ url: "https://example.test/p.wasm" }),
			createdAt: "2026-07-03T00:00:00.000Z",
			updatedAt: "2026-07-03T00:00:00.000Z",
		});

		// A fresh provider over the same path reads what the first one wrote.
		const second = createNodeFsStorageProvider(filePath);
		const record = await second.get("a");
		expect(record?.type).toBe("install-record");
	});

	it("filters query by type and createdAfter/createdBefore", async () => {
		const provider = createNodeFsStorageProvider(join(dir, "q.json"));
		await provider.putMany([
			{
				id: "old",
				type: "config-override",
				payload: "{}",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "new",
				type: "config-override",
				payload: "{}",
				createdAt: "2026-07-01T00:00:00.000Z",
				updatedAt: "2026-07-01T00:00:00.000Z",
			},
			{
				id: "future",
				type: "config-override",
				payload: "{}",
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
			},
			{
				id: "other",
				type: "scheduler-entry",
				payload: "{}",
				createdAt: "2026-07-01T00:00:00.000Z",
				updatedAt: "2026-07-01T00:00:00.000Z",
			},
		]);

		const overrides = await provider.query({ type: "config-override" });
		expect(overrides.map((r) => r.id)).toEqual(["old", "new", "future"]);

		const recent = await provider.query({
			type: "config-override",
			createdAfter: "2026-06-01T00:00:00.000Z",
		});
		expect(recent.map((r) => r.id)).toEqual(["new", "future"]);

		const before = await provider.query({
			type: "config-override",
			createdBefore: "2026-07-15T00:00:00.000Z",
		});
		expect(before.map((r) => r.id)).toEqual(["old", "new"]);
	});
});
