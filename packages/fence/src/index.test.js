import { describe, expect, it } from "vitest";
import { FenceCore } from "./index.js";

describe("FenceCore", () => {
	it("returns an empty audit report until boundary rules are implemented", async () => {
		const fence = new FenceCore();
		await expect(fence.audit()).resolves.toEqual([]);
	});
});
