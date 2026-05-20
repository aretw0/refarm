import { describe, expect, it } from "vitest";
import { ThresherCore } from "./index.js";

describe("ThresherCore", () => {
	it("returns an empty audit report until compatibility rules are implemented", async () => {
		const thresher = new ThresherCore();
		await expect(thresher.audit()).resolves.toEqual([]);
	});
});
