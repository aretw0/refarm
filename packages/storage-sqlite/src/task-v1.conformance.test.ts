import { runTaskV1Conformance } from "@refarm.dev/task-contract-v1";
import { describe, expect, it } from "vitest";

import { createTaskV1StorageAdapter } from "./task-v1.adapter";

describe("@refarm.dev/storage-sqlite task:v1 conformance", () => {
	it("passes task:v1 contract", async () => {
		const adapter = createTaskV1StorageAdapter();
		const result = await runTaskV1Conformance(adapter);

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
		expect(result.total).toBe(7);
	});
});
