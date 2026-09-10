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
		expect(names).toContain("intention");
		expect(names).toContain("web");
		expect(names).toContain("tui");
		expect(names).toContain("doctor");
		expect(names).toContain("check");
		expect(names).toContain("config");
		expect(names).toContain("migrate");
		expect(names).toContain("capabilities");
		expect(names).toContain("project");
		expect(names).toContain("open-url");
		expect(names).toContain("actions");
		expect(names).toContain("telemetry");
		expect(names).toContain("tidy");
		expect(names).toContain("tree");
	});

	/**
	 * THE OPTION LISTS THAT USED TO BE HERE FROZE THE DEFECT THEY WERE NAMED AFTER.
	 *
	 * This test asserted each stub's options against a hardcoded literal, so when `program.ts` fell
	 * behind the real commands the literal simply matched the stub — it was pinned to the wrong
	 * side. Measured 2026-08-12: `refarm sow --reconfigure`, `refarm init --json` and
	 * `refarm init --template` were all rejected by the CLI while their commands accepted them, and
	 * this test was green throughout, because a snapshot of a mistake agrees with the mistake.
	 *
	 * Option parity now lives in `lazy-command-parity.test.ts`, which compares the stub against the
	 * REAL command instead of against a list a human typed. What stays here is the part that has no
	 * other owner: the positional argument, which `toArgs` passes by position and would silently
	 * misplace.
	 */
	it("keeps the lazy init stub's positional argument", () => {
		const init = program.commands.find((command) => command.name() === "init");
		expect(init?.registeredArguments.map((argument) => argument.name())).toEqual(["name"]);
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
		expect(help).toContain("refarm check --next-command");
		expect(help).toContain("refarm tidy imports --check");
		expect(help).toContain("refarm capabilities --json");
		expect(help).toContain("refarm project handoff validate --json");
		expect(help).toContain("refarm intention check --profile cross-device-handoff --json");
		expect(help).toContain("refarm agent --next-command");
		expect(help).toContain("refarm agent finish --next-command");
		expect(help).toContain("refarm agent finish --lane after-edit --run --json");
		expect(help).toContain("refarm agent finish --lane before-push --run --json");
		expect(help).toContain("refarm agent finish --lane handoffs --run --json");
		expect(help).toContain("refarm agent finish --fix --run");
		expect(help).toContain("refarm agent finish --profile package --workspace apps/refarm --run");
		expect(help).toContain("refarm config set runtime.autostart always");
		expect(help).toContain("refarm model current");
		expect(help).toContain("refarm model base-url http://127.0.0.1:8000");
		expect(help).toContain("Inside the interactive session");
		expect(help).toContain("/cls");
	});

	it("uses shared runtime metadata resolver for CLI version", () => {
		expect(program.version()).toBe(resolveRefarmVersion());
	});
});
