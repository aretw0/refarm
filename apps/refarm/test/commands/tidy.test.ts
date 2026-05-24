import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createTidyCommand,
	resolveTidyImportsSpec,
	type TidyDeps,
} from "../../src/commands/tidy.js";

function makeDeps(overrides: Partial<TidyDeps> = {}): TidyDeps {
	return {
		cwd: () => "/workspaces/refarm",
		run: vi.fn().mockResolvedValue({ exitCode: 0 }),
		...overrides,
	};
}

describe("resolveTidyImportsSpec", () => {
	const originalPackageManager = process.env.REFARM_PACKAGE_MANAGER;

	afterEach(() => {
		if (originalPackageManager === undefined) {
			delete process.env.REFARM_PACKAGE_MANAGER;
		} else {
			process.env.REFARM_PACKAGE_MANAGER = originalPackageManager;
		}
	});

	it("maps import organization to a package-manager script command", () => {
		process.env.REFARM_PACKAGE_MANAGER = "pnpm";

		expect(
			resolveTidyImportsSpec({
				cwd: ".",
				check: true,
				files: ["apps/refarm/src/program.ts"],
			}),
		).toEqual({
			command: "pnpm",
			args: [
				"-C",
				".",
				"run",
				"imports:organize",
				"--check",
				"apps/refarm/src/program.ts",
			],
			display: "pnpm -C . run imports:organize --check apps/refarm/src/program.ts",
		});
	});
});

describe("tidyCommand", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	it("documents import tidy workflow in help", () => {
		const command = createTidyCommand(makeDeps());
		let help = "";
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		command.outputHelp();

		expect(help).toContain("refarm tidy imports");
		expect(help).toContain("refarm tidy imports --check");
		expect(help).toContain("changed source files");
		expect(help).toContain("REFARM_PACKAGE_MANAGER=pnpm|npm|yarn|bun");
	});

	it("prints import command dry-runs as JSON", async () => {
		const deps = makeDeps({ cwd: () => "." });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createTidyCommand(deps).parseAsync(
			["imports", "--check", "--dry-run", "--json", "apps/refarm/src/program.ts"],
			{ from: "user" },
		);

		expect(deps.run).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			action: "imports",
			check: true,
			files: ["apps/refarm/src/program.ts"],
			command: "pnpm",
			args: [
				"-C",
				".",
				"run",
				"imports:organize",
				"--check",
				"apps/refarm/src/program.ts",
			],
			display: "pnpm -C . run imports:organize --check apps/refarm/src/program.ts",
			dryRun: true,
			ok: true,
			operation: "imports",
			nextAction: null,
			nextActions: [],
			nextCommand: "refarm tidy imports --check 'apps/refarm/src/program.ts'",
			nextCommands: [
				"refarm tidy imports --check 'apps/refarm/src/program.ts'",
			],
		});
	});

	it("captures import output in JSON mode", async () => {
		const deps = makeDeps({
			cwd: () => ".",
			run: vi.fn().mockResolvedValue({
				exitCode: 1,
				stdout: "apps/refarm/src/program.ts\n",
				stderr: "Imports need organizing in 1 file.\n",
			}),
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createTidyCommand(deps).parseAsync(["imports", "--check", "--json"], {
			from: "user",
		});

		expect(deps.run).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "pnpm",
				args: ["-C", ".", "run", "imports:organize", "--check"],
			}),
			{ capture: true },
		);
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			exitCode: number;
			stdout: string;
			stderr: string;
			nextAction: string;
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "tidy-imports-failed",
			nextAction: "refarm tidy imports",
			nextCommand: "refarm tidy imports",
		});
		expect(payload.nextCommands).toContain("refarm tidy imports --check");
		expect(payload.exitCode).toBe(1);
		expect(payload.stdout).toContain("apps/refarm/src/program.ts");
		expect(payload.stderr).toContain("Imports need organizing");
		expect(process.exitCode).toBe(1);
	});

	it("quotes import recovery commands for explicit file paths", async () => {
		const deps = makeDeps({
			cwd: () => ".",
			run: vi.fn().mockResolvedValue({
				exitCode: 1,
				stdout: "",
				stderr: "Imports need organizing.\n",
			}),
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createTidyCommand(deps).parseAsync(
			["imports", "--check", "--json", "apps/refarm/src/a file's test.ts"],
			{ from: "user" },
		);

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload.nextCommand).toBe(
			"refarm tidy imports 'apps/refarm/src/a file'\"'\"'s test.ts'",
		);
		expect(payload.nextCommands).toContain(
			"refarm tidy imports --check 'apps/refarm/src/a file'\"'\"'s test.ts'",
		);
	});

	it("prints successful import results as actionable JSON", async () => {
		const deps = makeDeps({
			cwd: () => ".",
			run: vi.fn().mockResolvedValue({
				exitCode: 0,
				stdout: "Imports already organized.\n",
				stderr: "",
			}),
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createTidyCommand(deps).parseAsync(["imports", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			exitCode: number;
			nextAction: string | null;
			nextActions: string[];
		};
		expect(payload).toMatchObject({
			ok: true,
			exitCode: 0,
			nextAction: null,
			nextActions: [],
		});
	});
});
