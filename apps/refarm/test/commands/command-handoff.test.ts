import { describe, expect, it } from "vitest";
import {
	joinCommand,
	quoteCommandArg,
	refarmCommand,
	shellCommand,
	workspaceCommand,
} from "../../src/commands/command-handoff.js";

describe("command handoff helpers", () => {
	it("quotes command arguments with shell-safe JSON string syntax", () => {
		expect(quoteCommandArg("hello world")).toBe("'hello world'");
		expect(quoteCommandArg('say "hi"')).toBe("'say \"hi\"'");
		expect(quoteCommandArg("don't expand $HOME")).toBe(
			"'don'\"'\"'t expand $HOME'",
		);
	});

	it("builds refarm command strings", () => {
		expect(refarmCommand(["ask", quoteCommandArg("hello"), "--json"])).toBe(
			"refarm ask 'hello' --json",
		);
	});

	it("builds workspace-scoped command strings", () => {
		expect(workspaceCommand("/workspaces/my farm", "refarm sow")).toBe(
			"cd '/workspaces/my farm' && refarm sow",
		);
	});

	it("builds shell-ready commands from executable argv", () => {
		expect(shellCommand("pnpm", ["exec", "jco", "my plugin.wasm"])).toBe(
			"pnpm 'exec' 'jco' 'my plugin.wasm'",
		);
	});

	it("joins already-tokenized command parts", () => {
		expect(joinCommand(["refarm", "guide", "--json"])).toBe("refarm guide --json");
	});
});
