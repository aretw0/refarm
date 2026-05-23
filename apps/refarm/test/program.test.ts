import { describe, expect, it } from "vitest";
import { resolveRefarmVersion } from "../src/commands/runtime-metadata.js";
import { program } from "../src/program.js";

describe("refarm program", () => {
	it("registers unified host entry commands", () => {
		const names = program.commands.map((command) => command.name());
		expect(names).toContain("init");
		expect(names).toContain("sow");
		expect(names).toContain("model");
		expect(names).toContain("status");
		expect(names).toContain("headless");
		expect(names).toContain("web");
		expect(names).toContain("tui");
		expect(names).toContain("doctor");
		expect(names).toContain("check");
		expect(names).toContain("config");
		expect(names).toContain("migrate");
		expect(names).toContain("open-url");
		expect(names).toContain("actions");
		expect(names).toContain("telemetry");
		expect(names).toContain("tidy");
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

	it("documents runtime credential reload behavior in lazy sow help", () => {
		const sow = program.commands.find((command) => command.name() === "sow");
		let help = "";
		sow?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		sow?.outputHelp();

		expect(help).toContain("The Refarm runtime reloads Silo credentials");
	});

	it("documents lazy init and migrate workflows", () => {
		const init = program.commands.find((command) => command.name() === "init");
		const migrate = program.commands.find(
			(command) => command.name() === "migrate",
		);
		let initHelp = "";
		let migrateHelp = "";
		init?.configureOutput({
			writeOut: (value) => {
				initHelp += value;
			},
		});
		migrate?.configureOutput({
			writeOut: (value) => {
				migrateHelp += value;
			},
		});

		init?.outputHelp();
		migrate?.outputHelp();

		expect(initHelp).toContain("refarm init my-workspace");
		expect(initHelp).toContain("workspace identity is metadata");
		expect(initHelp).toContain("~/.refarm/identity.json");
		expect(initHelp).toContain("After init, run refarm sow to configure model credentials");
		expect(initHelp).toContain("refarm model current");
		expect(initHelp).toContain("refarm guide");
		expect(migrateHelp).toContain(
			"refarm migrate --target https://github.com/user/fork.git --dry-run",
		);
		expect(migrateHelp).toContain("Use --dry-run first");
	});

	it("documents common operator workflows in root help", () => {
		let help = "";
		program.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		program.outputHelp();

		expect(help).toContain("refarm ask \"hello\"");
		expect(help).toContain("refarm runtime");
		expect(help).toContain("refarm check --next-action");
		expect(help).toContain("refarm tidy imports --check");
		expect(help).toContain("refarm config set runtime.autostart always");
		expect(help).toContain("refarm model current");
		expect(help).toContain("refarm model base-url http://127.0.0.1:8000");
		expect(help).toContain("Inside the interactive session");
	});

	it("uses shared runtime metadata resolver for CLI version", () => {
		expect(program.version()).toBe(resolveRefarmVersion());
	});
});
