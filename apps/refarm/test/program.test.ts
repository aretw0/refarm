import { describe, expect, it } from "vitest";
import { resolveRefarmVersion } from "../src/commands/runtime-metadata.js";
import { program } from "../src/program.js";

describe("refarm program", () => {
	it("registers unified host entry commands", () => {
		const names = program.commands.map((command) => command.name());
		expect(names).toContain("status");
		expect(names).toContain("headless");
		expect(names).toContain("web");
		expect(names).toContain("tui");
		expect(names).toContain("doctor");
	});

	it("uses shared runtime metadata resolver for CLI version", () => {
		expect(program.version()).toBe(resolveRefarmVersion());
	});
});
