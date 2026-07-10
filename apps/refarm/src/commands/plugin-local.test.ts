import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn(),
		readdirSync: vi.fn(() => []),
		mkdirSync: vi.fn(),
		readFileSync: vi.fn(),
	};
});
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		writeFile: vi.fn().mockResolvedValue(undefined),
		mkdir: vi.fn().mockResolvedValue(undefined),
		rename: vi.fn().mockResolvedValue(undefined),
	};
});

const mockFs = await import("node:fs");
const mockFsPromises = await import("node:fs/promises");

describe("extension commands", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("extensionCommand exports a Commander Command named 'extension'", async () => {
		const { extensionCommand } = await import("./plugin-local.js");
		expect(extensionCommand.name()).toBe("extension");
	});

	it("extension new generates id as @local/<name>", async () => {
		vi.mocked(mockFs.existsSync).mockReturnValue(false);
		const { buildExtJson } = await import("./plugin-scaffold.js");
		const ext = buildExtJson("my-tool");
		expect(ext.id).toBe("@local/my-tool");
		expect(ext.version).toBe("0.0.1");
	});

	it("extension new --verb scaffolds a dispatchable local extension", async () => {
		vi.mocked(mockFs.existsSync).mockReturnValue(false);
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const { extensionCommand } = await import("./plugin-local.js");

		await extensionCommand.parseAsync(["new", "wallet", "--verb", "open", "--json"], {
			from: "user",
		});

		const writes = vi.mocked(mockFsPromises.writeFile).mock.calls;
		const extWrite = writes.find(([file]) => String(file).endsWith("ext.json"));
		const indexWrite = writes.find(([file]) => String(file).endsWith("index.js"));
		expect(extWrite).toBeDefined();
		expect(indexWrite).toBeDefined();

		const ext = JSON.parse(String(extWrite?.[1]));
		expect(ext.capabilities).toEqual({
			provides: ["wallet:open"],
			subscribes: ["wallet:dispatch"],
		});
		const report = JSON.parse(String(consoleLogSpy.mock.calls.at(-1)?.[0]));
		expect(report.surfaceName).toBe("wallet-open");
		expect(report.surfaceCommand).toBe("refarm wallet-open --json");
		expect(String(indexWrite?.[1])).toContain("async onEvent");
		expect(String(indexWrite?.[1])).toContain("wallet:dispatch");
		expect(String(indexWrite?.[1])).toContain('case "open"');
		consoleLogSpy.mockRestore();
	});

	// ADR-086: the scaffold builder is command-neutral — `plugin new` reuses it, so
	// the report's `command` + the list handoff must name whichever verb was used.
	it("buildCreatedPluginReport defaults to `extension` and its list handoff", async () => {
		vi.mocked(mockFs.existsSync).mockReturnValue(false);
		const { buildCreatedPluginReport } = await import("./plugin-scaffold.js");
		const report = await buildCreatedPluginReport({
			name: "my-tool",
			isGlobal: false,
			cwd: process.cwd(),
			homeDir: os.homedir(),
		});
		expect(report.ok).toBe(true);
		if (report.ok !== false) {
			expect(report.command).toBe("extension");
			// reload handoff is already plugin-scoped; the LIST handoff follows the verb.
			expect(report.nextCommands).toContain("refarm extension list --json");
		}
	});

	it("buildCreatedPluginReport stamps `plugin` when asked (plugin new)", async () => {
		vi.mocked(mockFs.existsSync).mockReturnValue(false);
		const { buildCreatedPluginReport } = await import("./plugin-scaffold.js");
		const report = await buildCreatedPluginReport({
			name: "my-tool",
			isGlobal: false,
			cwd: process.cwd(),
			homeDir: os.homedir(),
			commandName: "plugin",
		});
		expect(report.ok).toBe(true);
		if (report.ok !== false) {
			expect(report.command).toBe("plugin");
			expect(report.operation).toBe("new");
			expect(report.nextCommands).toContain("refarm plugin list --json");
		}
	});

	it("buildCreatedPluginReport returns an error envelope for an invalid name", async () => {
		const { buildCreatedPluginReport } = await import("./plugin-scaffold.js");
		const report = await buildCreatedPluginReport({
			name: "Bad Name!",
			isGlobal: false,
			cwd: process.cwd(),
			homeDir: os.homedir(),
			commandName: "plugin",
		});
		// Pure: returns an error envelope, never throws or sets process.exitCode.
		expect(report.ok).toBe(false);
		expect((report as { command?: string }).command).toBe("plugin");
		expect((report as { error?: string }).error).toBe("invalid-name");
	});

	it("extension list reads project and global dirs", async () => {
		vi.mocked(mockFs.existsSync).mockReturnValue(true);
		vi.mocked(mockFs.readdirSync).mockReturnValue([
			{ name: "my-tool", isDirectory: () => true },
		] as unknown as ReturnType<typeof import("node:fs").readdirSync>);
		vi.mocked(mockFs.readFileSync).mockReturnValue(
			JSON.stringify({ id: "@local/my-tool", name: "My Tool", version: "0.0.1" }),
		);

		const { listExtensions } = await import("./plugin-scaffold.js");
		const result = listExtensions(process.cwd(), os.homedir());
		expect(result.some((e: { id: string }) => e.id === "@local/my-tool")).toBe(true);
	});

	it("save command errors when neither --global nor --local is passed", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { extensionCommand } = await import("./plugin-local.js");

		await extensionCommand.parseAsync(["save", "my-tool"], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("--global"));
		consoleErrorSpy.mockRestore();
	});

	it("new command rejects names with path separators", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const { extensionCommand } = await import("./plugin-local.js");

		await extensionCommand.parseAsync(["new", "../evil"], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid extension name"));
		consoleErrorSpy.mockRestore();
	});
});
