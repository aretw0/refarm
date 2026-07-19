import { describe, expect, it } from "vitest";

import { scriptedInput } from "./tui-input.js";

describe("scriptedInput", () => {
	it("yields each key in order, then null when exhausted", async () => {
		const input = scriptedInput([{ name: "down" }, { name: "return" }]);
		expect(await input.readKey()).toEqual({ name: "down" });
		expect(await input.readKey()).toEqual({ name: "return" });
		expect(await input.readKey()).toBeNull();
	});

	it("close() exhausts the source immediately", async () => {
		const input = scriptedInput([{ name: "a" }, { name: "b" }]);
		input.close();
		expect(await input.readKey()).toBeNull();
	});
});
