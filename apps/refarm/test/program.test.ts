import { describe, expect, it } from "vitest";
import { program } from "../src/program.js";

describe("refarm program", () => {
	it("registers unified host entry commands", () => {
		const names = program.commands.map((command) => command.name());
		expect(names).toContain("status");
		expect(names).toContain("headless");
		expect(names).toContain("doctor");
	});
});
