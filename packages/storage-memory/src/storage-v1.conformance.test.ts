import { runStorageV1Conformance } from "@refarm.dev/storage-contract-v1";
import { describe, expect, it } from "vitest";

import { MemoryStorage } from "./memory-storage.js";

describe("@refarm.dev/storage-memory storage:v1 conformance", () => {
	it("passes storage:v1 contract", async () => {
		const provider = new MemoryStorage();
		const result = await runStorageV1Conformance(provider);

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});
});
