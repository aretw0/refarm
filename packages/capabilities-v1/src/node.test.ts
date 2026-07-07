import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { RecordsManifest } from "@refarm.dev/records-contract-v1";

import {
	createLocalRecordsCommandDeps,
	localRecordsStatePath,
} from "./node.js";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop()!, { force: true, recursive: true });
	}
});

function tempDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "refarm-capabilities-node-"));
	tempDirs.push(dir);
	return dir;
}

function manifest(state = "draft"): RecordsManifest {
	return {
		manifestVersion: 1,
		records: [
			{
				id: "record:one",
				schemaVersion: 1,
				"@type": ["KnowledgeRecord"],
				"@context": "https://refarm.dev/contexts/records/v1",
				fields: { title: "One" },
				review: { state, at: "2026-07-07T00:00:00.000Z" },
				contentHash: "hash",
			},
		],
	} as RecordsManifest;
}

describe("capabilities node helpers", () => {
	it("builds deterministic local records state paths", () => {
		expect(localRecordsStatePath({ cwd: "/repo", appId: "wallet-t2" }))
			.toBe("/repo/.wallet-t2/manifest.json");
	});

	it("persists records command deps through a JSON file", async () => {
		const statePath = path.join(tempDir(), "manifest.json");
		const first = createLocalRecordsCommandDeps({
			seed: () => manifest(),
			statePath,
		});
		expect(first.loadManifest().records[0]?.review?.state).toBe("draft");

		await first.saveManifest?.(manifest("verified"));
		const second = createLocalRecordsCommandDeps({
			seed: () => manifest(),
			statePath,
		});

		expect(second.loadManifest().records[0]?.review?.state).toBe("verified");
		expect(JSON.parse(readFileSync(statePath, "utf-8"))).toMatchObject({
			records: [{ id: "record:one", review: { state: "verified" } }],
		});
	});
});
