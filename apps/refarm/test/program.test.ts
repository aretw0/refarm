import { describe, expect, it } from "vitest";
import { resolveRefarmVersion } from "../src/commands/runtime-metadata.js";
import { program } from "../src/program.js";

describe("refarm program", () => {
	it("registers unified host entry commands", () => {
		const names = program.commands.map((command) => command.name());
		expect(names).toContain("init");
		expect(names).toContain("sow");
		expect(names).toContain("status");
		expect(names).toContain("headless");
		expect(names).toContain("web");
		expect(names).toContain("tui");
		expect(names).toContain("doctor");
		expect(names).toContain("migrate");
		expect(names).toContain("open-url");
		expect(names).toContain("actions");
		expect(names).toContain("telemetry");
		expect(names).toContain("tree");
	});

	it("keeps lazy command stubs aligned with their public options", () => {
		const init = program.commands.find((command) => command.name() === "init");
		const sow = program.commands.find((command) => command.name() === "sow");
		const migrate = program.commands.find((command) => command.name() === "migrate");

		expect(init?.registeredArguments.map((argument) => argument.name())).toEqual([
			"name",
		]);
		expect(init?.options.map((option) => option.long)).toContain("--force");
		expect(sow?.options.map((option) => option.long)).toEqual([
			"--model",
			"--github",
			"--cloudflare",
			"--all",
		]);
		expect(migrate?.options.map((option) => option.long)).toEqual([
			"--target",
			"--dry-run",
		]);
	});

	it("uses shared runtime metadata resolver for CLI version", () => {
		expect(program.version()).toBe(resolveRefarmVersion());
	});
});
