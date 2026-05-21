import { describe, expect, it } from "vitest";
import { createSessionCommand } from "../../src/commands/session.js";

describe("session command", () => {
	it("documents bare refarm parity and REPL runtime commands in help", () => {
		let help = "";
		const command = createSessionCommand();
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});
		command.outputHelp();

		expect(help).toContain("refarm session --new");
		expect(help).toContain("Bare refarm runs the same launch flow");
		expect(help).toContain("/model, /login, and /reload");
	});
});
