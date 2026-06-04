import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	applicationCommand,
	applicationProcess,
	binaryCommand,
	commandTemplateParameters,
	instantiateCommandTemplate,
	instantiateCommandTemplateById,
	instantiateProcessTemplate,
	joinCommand,
	normalizeHandoffValues,
	quoteCommandArg,
	quoteCommandArgIfNeeded,
	shellCommand,
	substituteCommandTemplateValue,
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

	it("uses per-application command overrides for executable handoffs", () => {
		const previous = process.env.TOOL_COMMAND;
		process.env.TOOL_COMMAND = "C:\\tmp\\tool.cmd";
		try {
			expect(applicationCommand("tool", ["resume", "--json"])).toBe(
				"C:\\tmp\\tool.cmd resume --json",
			);
		} finally {
			if (previous === undefined) {
				delete process.env.TOOL_COMMAND;
			} else {
				process.env.TOOL_COMMAND = previous;
			}
		}
	});

	it.each([
		["/home/runner/.local/bin/refarm", "/home/runner/.local/bin/refarm resume --json"],
		["C:\\tmp\\refarm.cmd", "C:\\tmp\\refarm.cmd resume --json"],
		[
			"/home/runner/Refarm CLI/refarm",
			"'/home/runner/Refarm CLI/refarm' resume --json",
		],
	])("formats launcher override %s", (override, expected) => {
		const previous = process.env.TOOL_COMMAND;
		process.env.TOOL_COMMAND = override;
		try {
			expect(applicationCommand("tool", ["resume", "--json"])).toBe(expected);
		} finally {
			if (previous === undefined) {
				delete process.env.TOOL_COMMAND;
			} else {
				process.env.TOOL_COMMAND = previous;
			}
		}
	});

	it("builds application process specs with raw command and shell-ready display", () => {
		const previous = process.env.TOOL_COMMAND;
		process.env.TOOL_COMMAND = "/home/runner/Refarm CLI/tool";
		try {
			expect(applicationProcess("tool", ["resume", "--json"])).toEqual({
				command: "/home/runner/Refarm CLI/tool",
				args: ["resume", "--json"],
				display: "'/home/runner/Refarm CLI/tool' resume --json",
			});
		} finally {
			if (previous === undefined) {
				delete process.env.TOOL_COMMAND;
			} else {
				process.env.TOOL_COMMAND = previous;
			}
		}
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

	it("extracts unique command template parameters from commands and argv", () => {
		expect(commandTemplateParameters([
			"refarm agent finish --workspace <dir>",
			"<dir>",
			"<ref>",
		])).toEqual(["dir", "ref"]);
	});

	it("substitutes command template values and rejects missing parameters", () => {
		expect(
			substituteCommandTemplateValue(
				"refarm agent finish --workspace <dir> --since <ref>",
				{ dir: "packages/cli", ref: "HEAD~1" },
			),
		).toBe("refarm agent finish --workspace packages/cli --since HEAD~1");
		expect(() =>
			substituteCommandTemplateValue("refarm agent finish --workspace <dir>", {}),
		).toThrow("Missing command template parameter: dir");
	});

	it("instantiates process templates without shell parsing", () => {
		expect(
			instantiateProcessTemplate(
				{
					command: "refarm",
					args: ["agent", "finish", "--workspace", "<dir>", "--since", "<ref>"],
					display: "refarm agent finish --workspace <dir> --since <ref>",
				},
				{ dir: "packages/cli", ref: "HEAD~1" },
			),
		).toEqual({
			command: "refarm",
			args: ["agent", "finish", "--workspace", "packages/cli", "--since", "HEAD~1"],
			display: "refarm agent finish --workspace packages/cli --since HEAD~1",
		});
	});

	it("instantiates public command templates with process specs and cwd", () => {
		expect(
			instantiateCommandTemplate(
				{
					id: "external-consumer-check-json",
					command: "refarm check --next-action --json",
					process: {
						command: "refarm",
						args: ["check", "--next-action", "--json"],
						display: "refarm check --next-action --json",
					},
					parameters: ["dir"],
					cwdParameter: "dir",
					useWhen: "Run the readiness gate from a consumer workspace.",
				},
				{ dir: "../agents-lab" },
			),
		).toEqual({
			id: "external-consumer-check-json",
			command: "refarm check --next-action --json",
			process: {
				command: "refarm",
				args: ["check", "--next-action", "--json"],
				display: "refarm check --next-action --json",
			},
			cwd: "../agents-lab",
		});
	});

	it("rejects command templates with undeclared placeholders", () => {
		expect(() =>
			instantiateCommandTemplate(
				{
					id: "bad-template",
					command: "refarm task status <effort-id> --json",
					parameters: [],
					useWhen: "Inspect a worker effort.",
				},
				{},
			),
		).toThrow("Undeclared command template parameter: effort-id");
	});

	it("instantiates command templates by id from a catalog", () => {
		const templates = [
			{
				id: "worker-task-status",
				command: "refarm task status <effort-id> --json",
				process: {
					command: "refarm",
					args: ["task", "status", "<effort-id>", "--json"],
					display: "refarm task status <effort-id> --json",
				},
				parameters: ["effort-id"],
				useWhen: "Inspect a worker effort.",
			},
			{
				id: "worker-task-logs",
				command: "refarm task logs <effort-id> --json",
				parameters: ["effort-id"],
				useWhen: "Inspect worker logs.",
			},
		];

		expect(
			instantiateCommandTemplateById(templates, "worker-task-status", {
				"effort-id": "effort-123",
			}),
		).toEqual({
			id: "worker-task-status",
			command: "refarm task status effort-123 --json",
			process: {
				command: "refarm",
				args: ["task", "status", "effort-123", "--json"],
				display: "refarm task status effort-123 --json",
			},
		});
		expect(() =>
			instantiateCommandTemplateById(templates, "missing", {}),
		).toThrow("Unknown command template: missing");
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
