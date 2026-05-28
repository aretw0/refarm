import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	applicationCommand,
	binaryCommand,
	joinCommand,
	normalizeHandoffValues,
	quoteCommandArg,
	quoteCommandArgIfNeeded,
	shellCommand,
	workspaceCommand,
} from "./command-handoff.js";

describe("command handoff helpers", () => {
	it("quotes command arguments with shell-safe JSON string syntax", () => {
		expect(quoteCommandArg("hello world")).toBe("'hello world'");
		expect(quoteCommandArg('say "hi"')).toBe("'say \"hi\"'");
		expect(quoteCommandArg("don't expand $HOME")).toBe(
			"'don'\"'\"'t expand $HOME'",
		);
	});

	it("quotes command arguments only when needed", () => {
		expect(quoteCommandArgIfNeeded("effort-1")).toBe("effort-1");
		expect(quoteCommandArgIfNeeded("urn:refarm:task:v1:abc123")).toBe(
			"urn:refarm:task:v1:abc123",
		);
		expect(quoteCommandArgIfNeeded("effort with space")).toBe(
			"'effort with space'",
		);
	});

	it("builds application command strings without product-specific naming", () => {
		expect(applicationCommand("tool", ["ask", quoteCommandArg("hello")])).toBe(
			"tool ask 'hello'",
		);
	});

	it("keeps applicationCommand as a product-agnostic binary wrapper", () => {
		const args = ["ask", quoteCommandArg("hello"), "--json"];
		expect(binaryCommand("tool", args)).toBe(applicationCommand("tool", args));
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

	it("normalizes handoff command lists", () => {
		expect(normalizeHandoffValues([" refarm check ", "", "refarm check"])).toEqual([
			"refarm check",
		]);
	});

	it("keeps cli source handoff commands behind helpers", () => {
		const srcDir = path.dirname(fileURLToPath(import.meta.url));
		const sourceFiles = listSourceFiles(srcDir).filter(
			(file) => !file.endsWith(".test.ts"),
		);
		const offenders = sourceFiles.flatMap((file) => {
			const source = readFileSync(file, "utf8");
			const matches = source.match(/["'`]refarm\s+[a-z][^"'`]*/g) ?? [];
			return matches.map((match) => `${path.relative(srcDir, file)}: ${match}`);
		});

		expect(offenders).toEqual([]);
	});
});

function listSourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const fullPath = path.join(dir, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			return entry === "__fixtures__" ? [] : listSourceFiles(fullPath);
		}
		return fullPath.endsWith(".ts") ? [fullPath] : [];
	});
}
