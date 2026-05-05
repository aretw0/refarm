import { runSessionV1Conformance } from "@refarm.dev/session-contract-v1";
import { describe, expect, it } from "vitest";

import { createSessionV1StorageAdapter } from "./session-v1.adapter";

describe("@refarm.dev/storage-sqlite session:v1 conformance", () => {
	it("passes session:v1 contract", async () => {
		const adapter = createSessionV1StorageAdapter();
		const result = await runSessionV1Conformance(adapter);

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
		expect(result.total).toBe(5);
	});
});
