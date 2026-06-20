import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks — must be defined before any imports that use these modules
const {
	mockReadFileSync,
	mockExistsSync,
	mockCopyFileSync,
	mockReadFile,
	mockWriteFile,
	mockMkdir,
	mockRequireResolve,
	mockDigest,
	mockRunLaunchProcess,
} = vi.hoisted(() => {
	const mockDigest = vi.fn().mockReturnValue("abc123");
	return {
		mockReadFileSync: vi.fn(),
		mockExistsSync: vi.fn(),
		mockCopyFileSync: vi.fn(),
		mockReadFile: vi.fn(),
		mockWriteFile: vi.fn().mockResolvedValue(undefined),
		mockMkdir: vi.fn().mockResolvedValue(undefined),
		mockRequireResolve: vi.fn(),
		mockDigest,
		mockRunLaunchProcess: vi.fn(),
	};
});

vi.mock("node:fs", () => ({
	default: {
		readFileSync: mockReadFileSync,
		existsSync: mockExistsSync,
		copyFileSync: mockCopyFileSync,
	},
	readFileSync: mockReadFileSync,
	existsSync: mockExistsSync,
	copyFileSync: mockCopyFileSync,
}));

vi.mock("node:fs/promises", () => ({
	readFile: mockReadFile,
	writeFile: mockWriteFile,
	mkdir: mockMkdir,
}));

vi.mock("node:crypto", () => ({
	createHash: vi.fn().mockReturnValue({
		update: vi.fn().mockReturnThis(),
		digest: mockDigest,
	}),
}));

vi.mock("node:module", () => ({
	createRequire: vi.fn().mockReturnValue(
		Object.assign(
			vi.fn().mockImplementation((id: string) => {
				if (id.endsWith("/package.json")) return `/fake/node_modules/${id}`;
				throw new Error(`unexpected require(${id})`);
			}),
			{
				resolve: mockRequireResolve,
			},
		),
	),
}));

vi.mock("@refarm.dev/cli/launch-process", async () => {
	const actual = await vi.importActual<typeof import("@refarm.dev/cli/launch-process")>(
		"@refarm.dev/cli/launch-process",
	);
	return {
		...actual,
		runLaunchProcess: mockRunLaunchProcess,
	};
});

import { pluginCommand } from "../../src/commands/plugin.js";

async function run(...args: string[]) {
	await pluginCommand.parseAsync(args, { from: "user" });
}

describe("plugin install", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWriteFile.mockResolvedValue(undefined);
		mockMkdir.mockResolvedValue(undefined);
	});

	it("documents plugin install, status, and reload workflows in help", () => {
		let help = "";
		pluginCommand.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});
		pluginCommand.outputHelp();

		expect(help).toContain("refarm plugin status");
		expect(help).toContain("refarm plugin reload runtime-agent --json");
		expect(help).toContain("/reload runtime-agent");
		expect(help).toContain("refarm runtime ensure --wait --next-command");
		expect(help).toContain("refarm doctor --next-action");
		expect(help).toContain("refarm doctor");
		expect(help).toContain("refarm ask preflights the runtime agent plugin");
	});

	it("documents runtime reload after bundled plugin install", () => {
		const install = pluginCommand.commands.find(
			(command) => command.name() === "install",
		);
		let help = "";
		install?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		install?.outputHelp();

		expect(help).toContain("start or restart the runtime");
		expect(help).toContain("refarm plugin reload runtime-agent --json");
		expect(help).toContain("/reload runtime-agent");
		expect(help).toContain("refarm plugin status");
	});

	it("reports failure when npm package cannot be resolved", async () => {
		mockRequireResolve.mockImplementation(() => {
			throw new Error("MODULE_NOT_FOUND");
		});
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("install");

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("not found in node_modules"),
		);
		consoleSpy.mockRestore();
	});

	it("installs bundled runtime agent from local workspace when root node_modules does not link it", async () => {
		mockRequireResolve.mockImplementation(() => {
			throw new Error("MODULE_NOT_FOUND");
		});
		mockExistsSync.mockImplementation((input) => {
			const value = String(input).replace(/\\/g, "/");
			return value.endsWith("packages/pi-agent/package.json") ||
				value.endsWith("packages/pi-agent/dist/pi_agent.wasm");
		});
		mockReadFileSync
			.mockReturnValueOnce(JSON.stringify({ name: "@refarm.dev/pi-agent", version: "0.4.1" }))
			.mockReturnValueOnce(JSON.stringify({ version: "0.4.1" }))
			.mockReturnValueOnce(Buffer.from("wasm-bytes"))
			.mockReturnValueOnce(JSON.stringify({ id: "@refarm/pi-agent", version: "0.4.1" }));
		mockReadFile.mockRejectedValue(new Error("ENOENT"));
		mockDigest.mockReturnValue("deadbeef");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("install");

		expect(mockCopyFileSync).toHaveBeenCalledWith(
			expect.stringContaining("packages"),
			expect.stringContaining("plugin.wasm"),
		);
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("installed"),
		);
		consoleSpy.mockRestore();
		mockRequireResolve.mockReset();
		mockExistsSync.mockReset();
		mockReadFileSync.mockReset();
		mockReadFile.mockReset();
		mockReadFile.mockResolvedValue("");
		mockDigest.mockReset();
		mockDigest.mockReturnValue("abc123");
	});

	it("reports failure when WASM file is missing", async () => {
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/pi-agent/package.json");
		mockReadFileSync.mockReturnValue(JSON.stringify({ version: "0.4.1" }));
		mockReadFile.mockRejectedValue(new Error("ENOENT")); // no sentinel → needs install
		mockExistsSync.mockReturnValue(false); // WASM not built

		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("install");

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("WASM not found"),
		);
		consoleSpy.mockRestore();
	});

	it("skips install when already up-to-date (no --force)", async () => {
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/pi-agent/package.json");
		mockReadFileSync
			.mockReturnValueOnce(JSON.stringify({ version: "0.4.1" }))
			.mockReturnValueOnce(Buffer.from("wasm-bytes"));
		mockReadFile
			.mockResolvedValueOnce("0.4.1") // sentinel matches
			.mockResolvedValueOnce(
				JSON.stringify({
					integrity: "sha256-abc123",
					capabilities: { provides: ["agent:respond"] },
				}),
			);
		mockExistsSync.mockReturnValue(true);

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("update"); // update = install with force=false

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("already up-to-date"),
		);
		expect(mockCopyFileSync).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("reinstalls when installed bundled manifest is missing required capabilities", async () => {
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/pi-agent/package.json");
		mockReadFileSync
			.mockReturnValueOnce(JSON.stringify({ version: "0.4.1" }))
			.mockReturnValueOnce(Buffer.from("wasm-bytes"))
			.mockReturnValueOnce(JSON.stringify({ id: "@refarm/pi-agent", version: "0.4.1" }));
		mockReadFile
			.mockResolvedValueOnce("0.4.1")
			.mockResolvedValueOnce(
				JSON.stringify({
					integrity: "sha256-deadbeef",
					capabilities: { provides: ["integration:v1"] },
				}),
			);
		mockExistsSync.mockReturnValue(true);
		mockDigest.mockReturnValue("deadbeef");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("update");

		expect(mockCopyFileSync).toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("installed"),
		);
		consoleSpy.mockRestore();
	});

	it("reinstalls when --force is passed even if up-to-date", async () => {
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/pi-agent/package.json");
		mockReadFileSync
			.mockReturnValueOnce(JSON.stringify({ version: "0.4.1" })) // package.json version
			.mockReturnValueOnce(Buffer.from("wasm-bytes")) // WASM file bytes
			.mockReturnValueOnce(JSON.stringify({ id: "@refarm/pi-agent", version: "0.4.1" })); // manifest
		mockReadFile.mockResolvedValue("0.4.1"); // sentinel = same version
		mockExistsSync.mockReturnValue(true);
		mockDigest.mockReturnValue("deadbeef");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("install", "--force");

		expect(mockCopyFileSync).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("prints install results as JSON without operator log lines", async () => {
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/pi-agent/package.json");
		mockReadFileSync
			.mockReturnValueOnce(JSON.stringify({ version: "0.4.1" }))
			.mockReturnValueOnce(Buffer.from("wasm-bytes"))
			.mockReturnValueOnce(JSON.stringify({ id: "@refarm/pi-agent", version: "0.4.1" }));
		mockReadFile.mockRejectedValue(new Error("ENOENT"));
		mockExistsSync.mockReturnValue(true);
		mockDigest.mockReturnValue("deadbeef");

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("install", "--json");

		expect(logSpy).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			failed: 0,
			plugins: [
				{
					id: "@refarm/pi-agent",
					packageName: "@refarm.dev/pi-agent",
					status: "installed",
					version: "0.4.1",
					bytes: 10,
					integrity: "sha256-deadbeef",
				},
			],
			command: "plugin",
			operation: "install",
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand: "refarm plugin status --json",
			nextCommands: ["refarm plugin status --json"],
		});
		logSpy.mockRestore();
	});

	it("prints failed install results as JSON", async () => {
		mockRequireResolve.mockImplementation(() => {
			throw new Error("MODULE_NOT_FOUND");
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("install", "--json");

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			failed: 1,
			plugins: [
				{
					id: "@refarm/pi-agent",
					packageName: "@refarm.dev/pi-agent",
					status: "failed",
					version: null,
					message: "package @refarm.dev/pi-agent not found in node_modules",
				},
			],
			command: "plugin",
			operation: "install",
			ok: false,
			error: "plugin-install-failed",
			message: "package @refarm.dev/pi-agent not found in node_modules",
			nextAction: "refarm plugin install",
			nextActions: ["refarm plugin install"],
			nextCommand: "refarm plugin install --json",
			nextCommands: [
				"refarm plugin install --json",
				"refarm plugin status --json",
			],
		});
		expect(errorSpy).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("prints update results as JSON", async () => {
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/pi-agent/package.json");
		mockReadFileSync
			.mockReturnValueOnce(JSON.stringify({ version: "0.4.1" }))
			.mockReturnValueOnce(Buffer.from("wasm-bytes"));
		mockReadFile
			.mockResolvedValueOnce("0.4.1")
			.mockResolvedValueOnce(
				JSON.stringify({
					integrity: "sha256-deadbeef",
					capabilities: { provides: ["agent:respond"] },
				}),
			);
		mockDigest.mockReturnValue("deadbeef");
		mockExistsSync.mockReturnValue(true);

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("update", "--json");

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			failed: 0,
			plugins: [
				{
					id: "@refarm/pi-agent",
					packageName: "@refarm.dev/pi-agent",
					status: "cached",
					version: "0.4.1",
					message: "already up-to-date",
				},
			],
			command: "plugin",
			operation: "install",
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand: "refarm plugin status --json",
			nextCommands: ["refarm plugin status --json"],
		});
		logSpy.mockRestore();
	});
});

describe("plugin list", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows installed version from sentinel", async () => {
		mockReadFile.mockResolvedValue("0.4.1");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("list");

		const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
		expect(output).toContain("@refarm/pi-agent");
		expect(output).toContain("0.4.1");
		consoleSpy.mockRestore();
	});

	it("shows 'not installed' when sentinel is missing", async () => {
		mockReadFile.mockRejectedValue(new Error("ENOENT"));

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("list");

		const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
		expect(output).toContain("not installed");
		consoleSpy.mockRestore();
	});

	it("prints plugin inventory as JSON", async () => {
		mockReadFile.mockResolvedValue("0.4.1");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("list", "--json");

		const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0])) as {
			plugins: Array<{
				id: string;
				version: string | null;
				source: string;
				installed: boolean;
			}>;
			nextCommand: string | null;
		};
		expect(payload.plugins).toEqual([
			{
				id: "@refarm/pi-agent",
				version: "0.4.1",
				source: "bundled",
				installed: true,
			},
		]);
		expect(payload.nextCommand).toBe("refarm plugin status --json");
		consoleSpy.mockRestore();
	});

	it("marks missing plugins as not installed in JSON", async () => {
		mockReadFile.mockRejectedValue(new Error("ENOENT"));

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("list", "--json");

		const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0])) as {
			plugins: Array<{ version: string | null; installed: boolean }>;
			nextCommand: string | null;
		};
		expect(payload.plugins[0]).toMatchObject({
			version: null,
			installed: false,
		});
		expect(payload.nextCommand).toBe("refarm plugin install --json");
		consoleSpy.mockRestore();
	});
});

describe("plugin status", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("shows runtime plugin load state", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					installed: ["@refarm/pi-agent"],
					loaded: ["@refarm/pi-agent"],
					local: [],
					known: ["@refarm/pi-agent"],
				}),
			}),
		);
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("status");

		const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
		expect(output).toContain("@refarm/pi-agent");
		expect(output).toContain("yes");
		expect(output).not.toContain("Runtime agent plugin is not loaded");
		consoleSpy.mockRestore();
	});

	it("guides when the runtime agent plugin is installed but not loaded", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					installed: ["@refarm/pi-agent"],
					loaded: [],
					local: [],
					known: ["@refarm/pi-agent"],
				}),
			}),
		);
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("status");

		const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
		expect(output).toContain("Runtime agent plugin is not loaded");
		expect(output).toContain("refarm plugin install");
		expect(output).toContain("refarm plugin reload runtime-agent --json");
		expect(output).toContain("refarm ask hello");
		consoleSpy.mockRestore();
	});

	it("prints runtime plugin load state as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					installed: ["@refarm/pi-agent"],
					loaded: [],
					local: ["@local/tool"],
					known: ["@refarm/pi-agent", "@local/tool"],
				}),
			}),
		);
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("status", "--json");

		const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0])) as {
			command: string;
			operation: string;
			ok: boolean;
			available: boolean;
			plugins: Array<{
				id: string;
				installed: boolean;
				loaded: boolean;
				local: boolean;
			}>;
			nextAction?: string;
			nextActions?: string[];
			nextCommand?: string;
			nextCommands?: string[];
		};
		expect(payload.command).toBe("plugin");
		expect(payload.operation).toBe("status");
		expect(payload.ok).toBe(false);
		expect(payload.available).toBe(true);
		expect(payload.plugins).toEqual([
			{
				id: "@refarm/pi-agent",
				installed: true,
				loaded: false,
				local: false,
			},
			{
				id: "@local/tool",
				installed: false,
				loaded: false,
				local: true,
			},
		]);
		expect(payload.nextAction).toBe("refarm plugin reload runtime-agent --json");
		expect(payload.nextActions).toEqual([
			"refarm plugin reload runtime-agent --json",
			"refarm plugin status --json",
		]);
		expect(payload.nextCommand).toBe("refarm plugin reload runtime-agent --json");
		expect(payload.nextCommands).toEqual([
			"refarm plugin reload runtime-agent --json",
			"refarm plugin status --json",
		]);
		expect(process.exitCode).toBe(1);
		consoleSpy.mockRestore();
	});

	it("reloads runtime plugins as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					reloadId: "reload-1",
					reloaded: ["@refarm/pi-agent"],
					deferred: [],
					skipped: [],
				}),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("reload", "pi-agent", "--json");

		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			requested: string[];
			reloaded: string[];
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			ok: true,
			command: "plugin",
			operation: "reload",
			requested: ["pi-agent"],
			reloaded: ["@refarm/pi-agent"],
			nextCommand: "refarm plugin status --json",
		});
		expect(fetch).toHaveBeenCalledWith(
			expect.stringContaining("/plugins/reload"),
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ pluginIds: ["@refarm/pi-agent"] }),
			}),
		);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("reports runtime plugin reload unavailability as JSON", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("reload", "pi-agent", "--json");

		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			nextCommand: string;
			nextCommands: string[];
			recommendations: { diagnostic: string; command: string }[];
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "runtime-plugin-reload-unavailable",
			nextCommand: "refarm runtime ensure --wait --next-command",
		});
		expect(payload.nextCommands).toContain("refarm runtime start --wait");
		expect(payload.nextCommands).toContain("refarm doctor --next-command");
		expect(payload.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "runtime-plugin-status-unavailable",
				command: "refarm runtime ensure --wait --next-command",
			}),
		]);
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("reports partial runtime plugin reloads as JSON failures", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					reloadId: "reload-1",
					reloaded: ["@local/tool"],
					deferred: [],
					skipped: ["@refarm/pi-agent"],
				}),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("reload", "pi-agent", "--json");

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			ok: false,
			command: "plugin",
			operation: "reload",
			error: "runtime-plugin-reload-partial",
			message: "One or more runtime plugins require a runtime restart to reload.",
			requested: ["pi-agent"],
			reloaded: ["@local/tool"],
			skipped: ["@refarm/pi-agent"],
			nextAction:
				"refarm plugin reload 'pi-agent' --restart-if-needed --wait --json",
			nextCommand:
				"refarm plugin reload 'pi-agent' --restart-if-needed --wait --json",
			nextCommands: [
				"refarm plugin reload 'pi-agent' --restart-if-needed --wait --json",
				"refarm plugin status --json",
				"refarm doctor --next-command",
			],
		});
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("sets exitCode for partial runtime plugin reloads in operator output", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					reloadId: "reload-1",
					reloaded: ["@local/tool"],
					deferred: [],
					skipped: ["@refarm/pi-agent"],
				}),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("reload", "pi-agent");

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("@local/tool reloaded"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("@refarm/pi-agent requires runtime restart to reload"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"refarm plugin reload 'pi-agent' --restart-if-needed --wait",
			),
		);
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("restarts runtime when partial plugin reload is allowed to restart", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					reloadId: "reload-1",
					reloaded: [],
					deferred: [],
					skipped: ["@refarm/pi-agent"],
				}),
			}),
		);
		mockRunLaunchProcess.mockResolvedValue({ exitCode: 0 });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("reload", "runtime-agent", "--restart-if-needed", "--wait", "--json");

		expect(errorSpy).not.toHaveBeenCalled();
		expect(mockRunLaunchProcess).toHaveBeenCalledWith(
			{
				command: "refarm",
				args: ["runtime", "restart", "--wait"],
				display: "refarm runtime restart --wait",
			},
			{ capture: false },
		);
		expect(mockRunLaunchProcess).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			ok: true,
			command: "plugin",
			operation: "reload",
			requested: ["runtime-agent"],
			reloaded: [],
			skipped: ["@refarm/pi-agent"],
			restarted: true,
			nextCommand: "refarm plugin status --json",
		});
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("restarts runtime when reload endpoint is unavailable and restart is allowed", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		mockRunLaunchProcess.mockResolvedValue({ exitCode: 0 });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("reload", "runtime-agent", "--restart-if-needed", "--wait", "--json");

		expect(errorSpy).not.toHaveBeenCalled();
		expect(mockRunLaunchProcess).toHaveBeenCalledWith(
			{
				command: "refarm",
				args: ["runtime", "restart", "--wait"],
				display: "refarm runtime restart --wait",
			},
			{ capture: false },
		);
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			ok: true,
			command: "plugin",
			operation: "reload",
			requested: ["runtime-agent"],
			reloaded: [],
			skipped: ["@refarm/pi-agent"],
			restarted: true,
			nextCommand: "refarm plugin status --json",
		});
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("reports restart failure when reload endpoint is unavailable", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		mockRunLaunchProcess.mockResolvedValue({ exitCode: 1 });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await run("reload", "runtime-agent", "--restart-if-needed", "--wait", "--json");

			expect(errorSpy).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
			expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
				ok: false,
				command: "plugin",
				operation: "reload",
				error: "runtime-plugin-restart-failed",
				requested: ["runtime-agent"],
				reloaded: [],
				skipped: ["@refarm/pi-agent"],
				restarted: false,
				nextCommand: "refarm runtime restart --wait",
			});
		} finally {
			process.exitCode = undefined;
			logSpy.mockRestore();
			errorSpy.mockRestore();
		}
	});

	it("prints unavailable runtime plugin state as JSON", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("status", "--json");

		const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0])) as {
			command: string;
			operation: string;
			ok: boolean;
			available: boolean;
			nextAction?: string;
			nextCommand?: string;
			nextCommands?: string[];
			recommendations?: { diagnostic: string; command: string }[];
			recovery?: {
				ensure: string;
				start: string;
				status: string;
				doctorNextAction: string;
				doctor: string;
			};
		};
		expect(payload).toMatchObject({
			command: "plugin",
			operation: "status",
			ok: false,
			available: false,
			nextAction: "refarm runtime ensure --wait --next-command",
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: [
				"refarm runtime ensure --wait --next-command",
				"refarm runtime start --wait",
				"refarm doctor --next-command",
			],
			recommendations: [
				expect.objectContaining({
					diagnostic: "runtime-plugin-status-unavailable",
					command: "refarm runtime ensure --wait --next-command",
				}),
			],
			recovery: {
				ensure: "refarm runtime ensure --wait --next-command",
				start: "refarm runtime start --wait",
				status: "refarm runtime status",
				doctorNextAction: "refarm doctor --next-action",
				doctor: "refarm doctor",
			},
		});
		expect(process.exitCode).toBe(1);
		consoleSpy.mockRestore();
	});

	it("exits non-zero when runtime status is unavailable", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("status");

		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("plugin status is unavailable"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("refarm runtime ensure --wait --next-command"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("refarm runtime start --wait"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("refarm runtime status"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("refarm doctor --next-action"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("refarm doctor"),
		);
		errorSpy.mockRestore();
	});
});

describe("plugin bundle", () => {
	const originalPackageManager = process.env.REFARM_PACKAGE_MANAGER;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.REFARM_PACKAGE_MANAGER = "pnpm";
		mockRunLaunchProcess.mockResolvedValue({ exitCode: 0 });
	});

	afterEach(() => {
		if (originalPackageManager === undefined) {
			delete process.env.REFARM_PACKAGE_MANAGER;
		} else {
			process.env.REFARM_PACKAGE_MANAGER = originalPackageManager;
		}
		vi.restoreAllMocks();
	});

	it("calls jco transpile through the detected package manager", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("bundle", "my-plugin.wasm", "-o", "./out");

		expect(mockRunLaunchProcess).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "pnpm",
				args: expect.arrayContaining(["exec", "jco", "transpile", "my-plugin.wasm", "-o", "./out"]),
			}),
			{ capture: false },
		);
		consoleSpy.mockRestore();
	});

	it("documents package-manager detection in bundle help", () => {
		const bundleCommand = pluginCommand.commands.find(
			(command) => command.name() === "bundle",
		);
		let help = "";
		bundleCommand?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		bundleCommand?.outputHelp();

		expect(help).toContain("REFARM_PACKAGE_MANAGER=npm");
		expect(help).toContain("refarm plugin bundle ./plugin.wasm --dry-run --json");
		expect(help).toContain("runs jco through the detected package manager");
		expect(help).toContain("Refarm maps this to pnpm exec, npm exec --, yarn, or bun x");
		expect(help).toContain("based on the project packageManager field or lockfile");
		expect(help).toContain("pnpm|npm|yarn|bun");
	});

	it("prints a bundle dry-run as JSON without running jco", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("bundle", "my plugin.wasm", "-o", "./out dir", "--dry-run", "--json");

		expect(mockRunLaunchProcess).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			dryRun: boolean;
			bundleCommand: string;
			packageManager: string;
			packageManagerCommand: string;
			process: {
				command: string;
				args: string[];
				display: string;
				packageManager: string;
			};
			processCommand: string;
			processArgs: string[];
			display: string;
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: true,
			command: "plugin",
			operation: "bundle",
			dryRun: true,
			bundleCommand:
				"pnpm 'exec' 'jco' 'transpile' 'my plugin.wasm' '-o' './out dir' '--name' 'my plugin'",
			packageManager: "pnpm",
			packageManagerCommand: "pnpm",
			process: {
				packageManager: "pnpm",
				command: "pnpm",
				args: [
					"exec",
					"jco",
					"transpile",
					"my plugin.wasm",
					"-o",
					"./out dir",
					"--name",
					"my plugin",
				],
				display:
					"pnpm exec jco transpile 'my plugin.wasm' -o './out dir' --name 'my plugin'",
			},
			processCommand: "pnpm",
			processArgs: [
				"exec",
				"jco",
				"transpile",
				"my plugin.wasm",
				"-o",
				"./out dir",
				"--name",
				"my plugin",
			],
			display:
				"pnpm exec jco transpile 'my plugin.wasm' -o './out dir' --name 'my plugin'",
			nextCommand:
				"refarm plugin bundle 'my plugin.wasm' -o './out dir' --name 'my plugin'",
		});
		expect(payload.nextCommands).toEqual([payload.nextCommand]);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("derives plugin name from filename when --name not provided", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("bundle", "my-plugin.wasm");

		expect(mockRunLaunchProcess).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "pnpm",
				args: expect.arrayContaining(["--name", "my-plugin"]),
			}),
			{ capture: false },
		);
		consoleSpy.mockRestore();
	});

	it("uses --name when provided", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("bundle", "my-plugin.wasm", "--name", "custom-name");

		expect(mockRunLaunchProcess).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "pnpm",
				args: expect.arrayContaining(["--name", "custom-name"]),
			}),
			{ capture: false },
		);
		consoleSpy.mockRestore();
	});

	it("captures bundle output in JSON mode", async () => {
		mockRunLaunchProcess.mockResolvedValue({
			exitCode: 0,
			stdout: "generated component\n",
			stderr: "jco warning\n",
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("bundle", "my-plugin.wasm", "--json");

		expect(mockRunLaunchProcess).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "pnpm",
				args: expect.arrayContaining(["jco", "transpile", "my-plugin.wasm"]),
			}),
			{ capture: true },
		);
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			stdout: string;
			stderr: string;
			process: {
				command: string;
				args: string[];
				display: string;
				packageManager: string;
			};
		};
		expect(payload).toMatchObject({
			ok: true,
			stdout: "generated component\n",
			stderr: "jco warning\n",
			process: {
				command: "pnpm",
				args: expect.arrayContaining(["jco", "transpile", "my-plugin.wasm"]),
				display: "pnpm exec jco transpile my-plugin.wasm -o ./dist --name my-plugin",
				packageManager: "pnpm",
			},
		});
		logSpy.mockRestore();
	});

	it("sets process.exitCode = 1 when jco fails", async () => {
		mockRunLaunchProcess.mockImplementation(() => {
			throw new Error("jco not found");
		});
		const originalExitCode = process.exitCode;
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("bundle", "bad-plugin.wasm");

		expect(process.exitCode).toBe(1);
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("Command: pnpm exec jco transpile bad-plugin.wasm"),
		);
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("REFARM_PACKAGE_MANAGER=pnpm|npm|yarn|bun"),
		);
		process.exitCode = originalExitCode;
		consoleSpy.mockRestore();
	});

	it("prints bundle failures as JSON without operator stderr", async () => {
		mockRunLaunchProcess.mockImplementation(() => {
			throw new Error("jco not found");
		});
		const originalExitCode = process.exitCode;
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("bundle", "bad-plugin.wasm", "--json");

		expect(mockRunLaunchProcess).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "pnpm",
				args: expect.arrayContaining(["jco", "transpile", "bad-plugin.wasm"]),
			}),
			{ capture: true },
		);
		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			message: string;
			packageManager: string;
			packageManagerCommand: string;
			process: {
				command: string;
				args: string[];
				display: string;
				packageManager: string;
			};
			processCommand: string;
			processArgs: string[];
			display: string;
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "plugin-bundle-failed",
			message: "jco not found",
			packageManager: "pnpm",
			packageManagerCommand: "pnpm",
			process: {
				packageManager: "pnpm",
				command: "pnpm",
				args: [
					"exec",
					"jco",
					"transpile",
					"bad-plugin.wasm",
					"-o",
					"./dist",
					"--name",
					"bad-plugin",
				],
				display: "pnpm exec jco transpile bad-plugin.wasm -o ./dist --name bad-plugin",
			},
			processCommand: "pnpm",
			processArgs: [
				"exec",
				"jco",
				"transpile",
				"bad-plugin.wasm",
				"-o",
				"./dist",
				"--name",
				"bad-plugin",
			],
			display: "pnpm exec jco transpile bad-plugin.wasm -o ./dist --name bad-plugin",
			nextCommand:
				"refarm plugin bundle 'bad-plugin.wasm' -o './dist' --name 'bad-plugin'",
		});
		expect(payload.nextCommands).toEqual([
			payload.nextCommand,
			"refarm plugin bundle 'bad-plugin.wasm' -o './dist' --name 'bad-plugin' --dry-run --json",
		]);
		expect(process.exitCode).toBe(1);
		process.exitCode = originalExitCode;
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});
});
