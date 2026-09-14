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
	isAbsoluteCommandPath,
	joinCommand,
	normalizeHandoffValues,
	privilegedApplicationCommand,
	quoteCommandArg,
	quoteCommandArgIfNeeded,
	shellCommand,
	substituteCommandTemplateValue,
	SUDO_SECURE_PATH_MODEL,
	workspaceCommand,
} from "./command-handoff.js";

describe("command handoff helpers", () => {
	it("quotes command arguments with shell-safe JSON string syntax", () => {
		expect(quoteCommandArg("hello world")).toBe("'hello world'");
		expect(quoteCommandArg('say "hi"')).toBe("'say \"hi\"'");
		expect(quoteCommandArg("don't expand $HOME")).toBe("'don'\"'\"'t expand $HOME'");
	});

	it("quotes command arguments only when needed", () => {
		expect(quoteCommandArgIfNeeded("effort-1")).toBe("effort-1");
		expect(quoteCommandArgIfNeeded("urn:sovereign:task:v1:abc123")).toBe(
			"urn:sovereign:task:v1:abc123",
		);
		expect(quoteCommandArgIfNeeded("effort with space")).toBe("'effort with space'");
	});

	it("builds application command strings without product-specific naming", () => {
		expect(applicationCommand("tool", ["ask", quoteCommandArg("hello")])).toBe("tool ask 'hello'");
	});

	it("keeps public command strings stable when launcher overrides are present", () => {
		const previous = process.env.TOOL_COMMAND;
		process.env.TOOL_COMMAND = "C:\\tmp\\tool.cmd";
		try {
			expect(applicationCommand("tool", ["resume", "--json"])).toBe("tool resume --json");
		} finally {
			if (previous === undefined) {
				delete process.env.TOOL_COMMAND;
			} else {
				process.env.TOOL_COMMAND = previous;
			}
		}
	});

	it.each([
		["/home/runner/.local/bin/refarm", "tool resume --json"],
		["C:\\tmp\\refarm.cmd", "tool resume --json"],
		["/home/runner/Refarm CLI/refarm", "tool resume --json"],
	])("ignores launcher override %s for public command strings", (override, expected) => {
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
		expect(
			commandTemplateParameters(["refarm agent finish --workspace <dir>", "<dir>", "<ref>"]),
		).toEqual(["dir", "ref"]);
	});

	it("substitutes command template values and rejects missing parameters", () => {
		expect(
			substituteCommandTemplateValue("refarm agent finish --workspace <dir> --since <ref>", {
				dir: "packages/cli",
				ref: "HEAD~1",
			}),
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
		expect(() => instantiateCommandTemplateById(templates, "missing", {})).toThrow(
			"Unknown command template: missing",
		);
	});

	it("keeps cli source handoff commands behind helpers", () => {
		const srcDir = path.dirname(fileURLToPath(import.meta.url));
		const sourceFiles = listSourceFiles(srcDir).filter((file) => !file.endsWith(".test.ts"));
		const offenders = sourceFiles.flatMap((file) => {
			const source = readFileSync(file, "utf8");
			const matches = source.match(/["'`]refarm\s+[a-z][^"'`]*/g) ?? [];
			return matches.map((match) => `${path.relative(srcDir, file)}: ${match}`);
		});

		expect(offenders).toEqual([]);
	});

	// ADR-087 phase 3: the generic package must not NAME the brand — not as a
	// `"refarm <verb>"` literal (guarded above) NOR as `applicationCommand("refarm",
	// …)` inside the package. A white-label app supplies the binary; the package
	// takes it. This guards the second form.
	it("never hardcodes the brand binary in applicationCommand/applicationProcess", () => {
		const srcDir = path.dirname(fileURLToPath(import.meta.url));
		// No exceptions: capability-index-data.ts was parameterized off "refarm"
		// (ADR-087 phase 3a — buildCapabilities(binary)), so NO generic cli source
		// may name the brand. Any offender fails.
		const sourceFiles = listSourceFiles(srcDir).filter((file) => !file.endsWith(".test.ts"));
		const offenders = sourceFiles.flatMap((file) => {
			const rel = path.relative(srcDir, file);
			const source = readFileSync(file, "utf8");
			const matches = source.match(/application(?:Command|Process)\(\s*["'`]refarm["'`]/g) ?? [];
			return matches.map((match) => `${rel}: ${match}`);
		});

		expect(offenders).toEqual([]);
	});
});

/**
 * A step that needs root is the one place where naming the binary is not enough. `sudo` replaces
 * `PATH` with `secure_path`, which omits the per-user bin directory a CLI installs into, so
 * `sudo -E tool …` fails with `command not found` exactly where the guidance was needed most.
 */
describe("privileged application commands", () => {
	it("names the interpreter and the entrypoint by absolute path, so nothing is looked up", () => {
		expect(
			privilegedApplicationCommand("tool", ["cert", "trust"], {
				execPath: "/usr/bin/node",
				execArgv: [],
				entrypoint: "/opt/tool/index.js",
			}),
		).toBe("sudo -E /usr/bin/node /opt/tool/index.js cert trust");
	});

	it("carries the module hooks the entrypoint was launched with", () => {
		expect(
			privilegedApplicationCommand("tool", ["cert", "trust"], {
				execPath: "/usr/bin/node",
				execArgv: ["--import", "file:///opt/tool/hook.mjs"],
				entrypoint: "/opt/tool/index.js",
			}),
		).toBe(
			"sudo -E /usr/bin/node --import file:///opt/tool/hook.mjs /opt/tool/index.js cert trust",
		);
	});

	it("leaves this session's own flags out of a line the operator is told to type", () => {
		expect(
			privilegedApplicationCommand("tool", ["cert", "trust"], {
				execPath: "/usr/bin/node",
				execArgv: ["--inspect-brk=9229", "--test", "--conditions=source"],
				entrypoint: "/opt/tool/index.js",
			}),
			// `=` is outside the unquoted-safe set, so the flag is quoted — still one argument.
		).toBe("sudo -E /usr/bin/node '--conditions=source' /opt/tool/index.js cert trust");
	});

	it("quotes a path with spaces so the shell still sees one argument", () => {
		expect(
			privilegedApplicationCommand("tool", ["cert", "trust"], {
				execPath: "/usr/bin/node",
				execArgv: [],
				entrypoint: "/opt/Tool CLI/index.js",
			}),
		).toBe("sudo -E /usr/bin/node '/opt/Tool CLI/index.js' cert trust");
	});

	it("falls back to the binary name when the process cannot describe itself", () => {
		// An embedded host, not a CLI. Inventing a path would be worse than naming the binary.
		expect(
			privilegedApplicationCommand("tool", ["cert", "trust"], {
				execPath: "/usr/bin/node",
				execArgv: [],
				entrypoint: null,
			}),
		).toBe("sudo -E tool cert trust");
		expect(
			privilegedApplicationCommand("tool", ["cert", "trust"], {
				execPath: "/usr/bin/node",
				execArgv: [],
				entrypoint: "dist/index.js",
			}),
		).toBe("sudo -E tool cert trust");
	});

	it("derives the path from the running process by default", () => {
		const command = privilegedApplicationCommand("tool", ["cert", "trust"]);
		expect(command.startsWith(`sudo -E ${quoteCommandArgIfNeeded(process.execPath)} `)).toBe(true);
		expect(command.endsWith(" cert trust")).toBe(true);
	});

	it("recognises the absolute paths a shell needs no PATH for", () => {
		expect(isAbsoluteCommandPath("/opt/tool/index.js")).toBe(true);
		expect(isAbsoluteCommandPath("C:\\tools\\tool.cmd")).toBe(true);
		expect(isAbsoluteCommandPath("\\\\host\\share\\tool.cmd")).toBe(true);
		expect(isAbsoluteCommandPath("tool")).toBe(false);
		expect(isAbsoluteCommandPath("./dist/index.js")).toBe(false);
		expect(isAbsoluteCommandPath("~/.local/bin/tool")).toBe(false);
	});

	it("models a sudo search path with no per-user bin directory in it", () => {
		// The environment truth the whole rule rests on.
		expect(SUDO_SECURE_PATH_MODEL.some((entry) => entry.includes(".local"))).toBe(false);
		expect(SUDO_SECURE_PATH_MODEL.some((entry) => entry.startsWith("/home"))).toBe(false);
		expect(SUDO_SECURE_PATH_MODEL).toContain("/usr/bin");
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
