import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installedPluginWasmPath } from "../../src/commands/plugin-install-path.js";

// Hoisted mocks — must be defined before any imports that use these modules
const {
	mockReadFileSync,
	mockExistsSync,
	mockReaddirSync,
	mockCopyFileSync,
	mockReadFile,
	mockWriteFile,
	mockMkdir,
	mockRequireResolve,
	mockDigest,
	mockRunProcessHandoff,
} = vi.hoisted(() => {
	const mockDigest = vi.fn().mockReturnValue("abc123");
	return {
		mockReadFileSync: vi.fn(),
		mockExistsSync: vi.fn(),
		// The unified `plugin list` reader (ADR-086) scans .refarm/extensions/ for
		// local plugins; this suite exercises bundled-only, so the scan finds none.
		mockReaddirSync: vi.fn(() => []),
		mockCopyFileSync: vi.fn(),
		mockReadFile: vi.fn(),
		mockWriteFile: vi.fn().mockResolvedValue(undefined),
		mockMkdir: vi.fn().mockResolvedValue(undefined),
		mockRequireResolve: vi.fn(),
		mockDigest,
		mockRunProcessHandoff: vi.fn(),
	};
});

vi.mock("node:fs", () => ({
	default: {
		readFileSync: mockReadFileSync,
		existsSync: mockExistsSync,
		readdirSync: mockReaddirSync,
		copyFileSync: mockCopyFileSync,
	},
	readFileSync: mockReadFileSync,
	existsSync: mockExistsSync,
	readdirSync: mockReaddirSync,
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

vi.mock("node:module", async () => {
	// The CLI projector (surface-terminal/cli-projector.ts) and capabilities-v1 host now
	// lazy-load commander via createRequire so their barrels are browser-safe (a static
	// `import { Command } from "commander"` crashes a browser bundle at module-init, where
	// node:events is a stub). Building the projected `plugin` group below therefore issues a
	// legitimate `require("commander")` — return the REAL module; anything else unexpected is
	// still a bug this guard should surface.
	const commander = await vi.importActual<typeof import("commander")>("commander");
	return {
		createRequire: vi.fn().mockReturnValue(
			Object.assign(
				vi.fn().mockImplementation((id: string) => {
					if (id === "commander") return commander;
					if (id.endsWith("/package.json")) return `/fake/node_modules/${id}`;
					throw new Error(`unexpected require(${id})`);
				}),
				{
					resolve: mockRequireResolve,
				},
			),
		),
	};
});

vi.mock("@refarm.dev/cli/process-handoff", async () => {
	const actual = await vi.importActual<typeof import("@refarm.dev/cli/process-handoff")>(
		"@refarm.dev/cli/process-handoff",
	);
	return {
		...actual,
		runProcessHandoff: mockRunProcessHandoff,
	};
});

import { toCommanderGroup } from "../../src/commands/capability-commander.js";
import {
	createPluginCapabilityGroup,
	pluginCapabilityHooks,
} from "../../src/commands/plugin-capability.js";

// The `plugin` command is now a tri-surface CapabilityGroup; drive its PROJECTED
// commander surface so these byte-stability assertions prove the group produces
// the exact envelopes the legacy command did. The group's defaults call the same
// real action functions, which the fs/process mocks above still intercept.
const pluginCommand = toCommanderGroup(
	createPluginCapabilityGroup(),
	pluginCapabilityHooks,
);

async function run(...args: string[]) {
	await pluginCommand.parseAsync(args, { from: "user" });
}

/**
 * Drive a non-JSON sub-verb and capture its human PROJECTION + the resulting exit
 * intent — the one place that knows the canonical projection channel (the projector
 * prints renderText via console.log) and that exit is derived from the envelope's
 * ok:false. Every non-JSON behavioral test reads `rendered`/`exitCode` from here
 * instead of re-spying console + re-joining calls by hand. Restores exitCode.
 */
async function renderNonJson(...args: string[]): Promise<{
	rendered: string;
	exitCode: number | string | undefined;
}> {
	const previousExitCode = process.exitCode;
	process.exitCode = undefined;
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	try {
		await run(...args);
		const rendered = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
		return { rendered, exitCode: process.exitCode };
	} finally {
		logSpy.mockRestore();
		process.exitCode = previousExitCode;
	}
}

describe("plugin install", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWriteFile.mockResolvedValue(undefined);
		mockMkdir.mockResolvedValue(undefined);
	});

	// The plugin group projects every sub-verb onto the CLI from one declaration.
	// The recovery/handoff prose the legacy `.addHelpText` carried now lives in the
	// verbs' envelopes (nextCommand/nextCommands), asserted by the JSON-envelope
	// tests below — help is a sub-verb index, not a doc surface.
	it("projects every plugin sub-verb onto the CLI", () => {
		let help = "";
		pluginCommand.configureOutput({ writeOut: (value) => (help += value) });
		pluginCommand.outputHelp();

		for (const verb of [
			"list",
			"status",
			"install",
			"update",
			"bundle",
			"reload",
			"permissions",
		]) {
			expect(help).toContain(verb);
		}
	});

	it("reports failure when npm package cannot be resolved", async () => {
		mockRequireResolve.mockImplementation(() => {
			throw new Error("MODULE_NOT_FOUND");
		});
		// The install envelope carries the per-plugin failure message; the projector
		// prints the renderText projection via console.log (its single human channel).
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("install");

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("not found in node_modules or workspace"),
		);
		logSpy.mockRestore();
	});

	it("installs bundled runtime agent from local workspace when root node_modules does not link it", async () => {
		mockRequireResolve.mockImplementation(() => {
			throw new Error("MODULE_NOT_FOUND");
		});
		mockExistsSync.mockImplementation((input) => {
			const value = String(input).replace(/\\/g, "/");
			return value.endsWith("packages/agent/package.json") ||
				value.endsWith("packages/agent/dist/agent.wasm");
		});
		mockReadFileSync
			.mockReturnValueOnce(JSON.stringify({ name: "@refarm.dev/agent", version: "0.4.1" }))
			.mockReturnValueOnce(JSON.stringify({ version: "0.4.1" }))
			.mockReturnValueOnce(Buffer.from("wasm-bytes"))
			.mockReturnValueOnce(JSON.stringify({ id: "@refarm/agent", version: "0.4.1" }));
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
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("workspace"),
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
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/agent/package.json");
		mockReadFileSync.mockReturnValue(JSON.stringify({ version: "0.4.1" }));
		mockReadFile.mockRejectedValue(new Error("ENOENT")); // no sentinel → needs install
		mockExistsSync.mockReturnValue(false); // WASM not built

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("install");

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("WASM not found"),
		);
		logSpy.mockRestore();
	});

	it("skips install when already up-to-date (no --force)", async () => {
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/agent/package.json");
		mockReadFileSync
			.mockReturnValueOnce(JSON.stringify({ version: "0.4.1" }))
			.mockReturnValueOnce(Buffer.from("wasm-bytes"));
		mockReadFile
			.mockResolvedValueOnce("0.4.1") // sentinel matches
			.mockResolvedValueOnce(
				JSON.stringify({
					integrity: "sha256-abc123",
					capabilities: { provides: ["integration:respond"] },
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
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/agent/package.json");
		mockReadFileSync
			.mockReturnValueOnce(JSON.stringify({ version: "0.4.1" }))
			.mockReturnValueOnce(Buffer.from("wasm-bytes"))
			.mockReturnValueOnce(JSON.stringify({ id: "@refarm/agent", version: "0.4.1" }));
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
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/agent/package.json");
		mockReadFileSync
			.mockReturnValueOnce(JSON.stringify({ version: "0.4.1" })) // package.json version
			.mockReturnValueOnce(Buffer.from("wasm-bytes")) // WASM file bytes
			.mockReturnValueOnce(JSON.stringify({ id: "@refarm/agent", version: "0.4.1" })); // manifest
		mockReadFile.mockResolvedValue("0.4.1"); // sentinel = same version
		mockExistsSync.mockReturnValue(true);
		mockDigest.mockReturnValue("deadbeef");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("install", "--force");

		expect(mockCopyFileSync).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("prints install results as JSON without operator log lines", async () => {
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/agent/package.json");
		// Keyed by PATH, not by call order: the install path now reads refarm's own config
		// before it reads anything of the plugin's, and a queue of `mockReturnValueOnce`
		// hands those reads the plugin's bytes — leaving the real reads with `undefined`.
		// Answering per path is order-proof and says what each read is actually for.
		mockReadFileSync.mockImplementation((target: unknown) => {
			const file = String(target);
			if (file.endsWith(".wasm")) return Buffer.from("wasm-bytes");
			if (file.endsWith("/package.json")) return JSON.stringify({ version: "0.4.1" });
			if (file.endsWith(".json")) return JSON.stringify({ id: "@refarm/agent", version: "0.4.1" });
			return "{}";
		});
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
					id: "@refarm/agent",
					packageName: "@refarm.dev/agent",
					status: "installed",
					version: "0.4.1",
					packageSource: "node_modules",
					packageDir: "/fake/node_modules/@refarm.dev/agent",
					// WHERE it landed — the directory the daemon loads from. Present on every
					// outcome, including `cached`, because a cached result is exactly the case
					// where knowing which directory was consulted matters most: two installers
					// once wrote two directories and this report could not tell them apart.
					installedPath: installedPluginWasmPath("@refarm/agent"),
					bytes: 10,
					integrity: "sha256-deadbeef",
				},
			],
			// The same pass materialises the runtime's rate catalog into the sovereign dir.
			// `existsSync` is mocked true here, so a catalog "already exists" — and this
			// fixture never wrote a provenance record for it, so the pass refuses to guess
			// whether the file is its own or a node's correction. It KEEPS the file and says
			// so, which is the whole point: this step never overwrites what it did not write.
			modelRateCatalog: {
				status: "unknown",
				path: expect.any(String),
				localCatalogVersion: null,
				shippedCatalogVersion: null,
				message: expect.stringContaining("no provenance record"),
			},
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
		// Nothing is on disk in this fixture — stated rather than inherited, so the
		// catalog step's answer below is the one this test means.
		mockExistsSync.mockReturnValue(false);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("install", "--json");

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			failed: 1,
			plugins: [
				{
					id: "@refarm/agent",
					packageName: "@refarm.dev/agent",
					status: "failed",
					version: null,
					packageSource: "unresolved",
					message: "package @refarm.dev/agent not found in node_modules or workspace",
				},
			],
			// Nothing resolves in this fixture, the catalog package included. It reports the
			// miss instead of failing the install: a node without a catalog still runs, and
			// prices from the agent's built-in table.
			modelRateCatalog: {
				status: "unresolved",
				path: expect.any(String),
				localCatalogVersion: null,
				shippedCatalogVersion: null,
				message:
					"package @refarm.dev/model-catalog-v1 not found in node_modules or workspace",
			},
			command: "plugin",
			operation: "install",
			ok: false,
			error: "plugin-install-failed",
			message: "package @refarm.dev/agent not found in node_modules or workspace",
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
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/agent/package.json");
		mockReadFileSync
			.mockReturnValueOnce(JSON.stringify({ version: "0.4.1" }))
			.mockReturnValueOnce(Buffer.from("wasm-bytes"));
		mockReadFile
			.mockResolvedValueOnce("0.4.1")
			.mockResolvedValueOnce(
				JSON.stringify({
					integrity: "sha256-deadbeef",
					capabilities: { provides: ["integration:respond"] },
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
					id: "@refarm/agent",
					packageName: "@refarm.dev/agent",
					status: "cached",
					version: "0.4.1",
					packageSource: "node_modules",
					packageDir: "/fake/node_modules/@refarm.dev/agent",
					// The cached case is the one this field exists for. "already up-to-date" was
					// TRUE about a directory nobody loaded, and without a path beside it there was
					// no way to see that from the report.
					installedPath: installedPluginWasmPath("@refarm/agent"),
					message: "already up-to-date",
				},
			],
			// Same fixture, same answer as `install`: a catalog is on disk with nothing
			// recording who wrote it, so `update` keeps it and reports the ambiguity rather
			// than resolving it in either direction.
			modelRateCatalog: {
				status: "unknown",
				path: expect.any(String),
				localCatalogVersion: null,
				shippedCatalogVersion: null,
				message: expect.stringContaining("no provenance record"),
			},
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
		expect(output).toContain("@refarm/agent");
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
		mockRequireResolve.mockReturnValue("/fake/node_modules/@refarm.dev/agent/package.json");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("list", "--json");

		const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0])) as {
			plugins: Array<{
				id: string;
				version: string | null;
				source: string;
				packageSource: string;
				packageDir: string | null;
				installed: boolean;
			}>;
			nextCommand: string | null;
		};
		expect(payload.plugins).toEqual([
			{
				id: "@refarm/agent",
				version: "0.4.1",
				source: "bundled",
				packageSource: "node_modules",
				packageDir: "/fake/node_modules/@refarm.dev/agent",
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
					installed: ["@refarm/agent"],
					loaded: ["@refarm/agent"],
					local: [],
					known: ["@refarm/agent"],
				}),
			}),
		);
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("status");

		const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
		expect(output).toContain("@refarm/agent");
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
					installed: ["@refarm/agent"],
					loaded: [],
					local: [],
					known: ["@refarm/agent"],
				}),
			}),
		);
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("status");

		const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
		expect(output).toContain("Runtime agent plugin is not loaded");
		expect(output).toContain("refarm plugin install");
		expect(output).toContain("refarm plugin reload agent --json");
		expect(output).toContain("refarm ask hello");
		consoleSpy.mockRestore();
	});

	it("prints runtime plugin load state as JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					installed: ["@refarm/agent"],
					loaded: [],
					local: ["@local/tool"],
					known: ["@refarm/agent", "@local/tool"],
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
				id: "@refarm/agent",
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
		expect(payload.nextAction).toBe("refarm plugin reload agent --json");
		expect(payload.nextActions).toEqual([
			"refarm plugin reload agent --json",
			"refarm plugin status --json",
		]);
		expect(payload.nextCommand).toBe("refarm plugin reload agent --json");
		expect(payload.nextCommands).toEqual([
			"refarm plugin reload agent --json",
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
					reloaded: ["@refarm/agent"],
					deferred: [],
					skipped: [],
				}),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("reload", "agent", "--json");

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
			requested: ["agent"],
			reloaded: ["@refarm/agent"],
			nextCommand: "refarm plugin status --json",
		});
		expect(fetch).toHaveBeenCalledWith(
			expect.stringContaining("/plugins/reload"),
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ pluginIds: ["@refarm/agent"] }),
			}),
		);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("reports runtime plugin reload unavailability as JSON", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("reload", "agent", "--json");

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
					skipped: ["@refarm/agent"],
				}),
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("reload", "agent", "--json");

		expect(errorSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			ok: false,
			command: "plugin",
			operation: "reload",
			error: "runtime-plugin-reload-partial",
			message: "One or more runtime plugins require runtime restart to reload.",
			requested: ["agent"],
			reloaded: ["@local/tool"],
			skipped: ["@refarm/agent"],
			nextAction:
				"refarm plugin reload agent --restart-if-needed --wait --json",
			nextCommand:
				"refarm plugin reload agent --restart-if-needed --wait --json",
			nextCommands: [
				"refarm plugin reload agent --restart-if-needed --wait --json",
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
					skipped: ["@refarm/agent"],
				}),
			}),
		);
		const { rendered, exitCode } = await renderNonJson("reload", "agent");

		// PROJECTION: reloaded/skipped/hint fold into one human string via console.log.
		expect(rendered).toContain("@local/tool reloaded");
		expect(rendered).toContain("@refarm/agent requires runtime restart to reload");
		expect(rendered).toContain(
			"refarm plugin reload agent --restart-if-needed --wait",
		);
		expect(exitCode).toBe(1); // ESSENTIAL: partial reload → failure exit
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
					skipped: ["@refarm/agent"],
				}),
			}),
		);
		mockRunProcessHandoff.mockResolvedValue({ exitCode: 0 });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("reload", "runtime-agent", "--restart-if-needed", "--wait", "--json");

		expect(errorSpy).not.toHaveBeenCalled();
		expect(mockRunProcessHandoff).toHaveBeenCalledWith(
			{
				command: "refarm",
				args: ["runtime", "restart", "--wait"],
				display: "refarm runtime restart --wait",
			},
			{ capture: false },
		);
		expect(mockRunProcessHandoff).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			ok: true,
			command: "plugin",
			operation: "reload",
			requested: ["runtime-agent"],
			reloaded: [],
			skipped: ["@refarm/agent"],
			restarted: true,
			nextCommand: "refarm plugin status --json",
		});
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("restarts runtime when reload endpoint is unavailable and restart is allowed", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		mockRunProcessHandoff.mockResolvedValue({ exitCode: 0 });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("reload", "runtime-agent", "--restart-if-needed", "--wait", "--json");

		expect(errorSpy).not.toHaveBeenCalled();
		expect(mockRunProcessHandoff).toHaveBeenCalledWith(
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
			skipped: ["@refarm/agent"],
			restarted: true,
			nextCommand: "refarm plugin status --json",
		});
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("reports restart failure when reload endpoint is unavailable", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		mockRunProcessHandoff.mockResolvedValue({ exitCode: 1 });
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
				skipped: ["@refarm/agent"],
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

		const { rendered, exitCode } = await renderNonJson("status");

		expect(exitCode).toBe(1); // ESSENTIAL: unavailable status → failure exit
		// PROJECTION: recovery lines fold into the one human string via console.log.
		expect(rendered).toContain("plugin status is unavailable");
		expect(rendered).toContain("refarm runtime ensure --wait --next-command");
		expect(rendered).toContain("refarm runtime start --wait");
		expect(rendered).toContain("refarm doctor --next-action");
		expect(rendered).toContain("refarm doctor");
	});
});

describe("plugin bundle", () => {
	const originalPackageManager = process.env.REFARM_PACKAGE_MANAGER;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.REFARM_PACKAGE_MANAGER = "pnpm";
		mockRunProcessHandoff.mockResolvedValue({ exitCode: 0 });
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

		expect(mockRunProcessHandoff).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "pnpm",
				args: expect.arrayContaining(["exec", "jco", "transpile", "my-plugin.wasm", "-o", "./out"]),
			}),
			{ capture: true },
		);
		consoleSpy.mockRestore();
	});


	it("prints a bundle dry-run as JSON without running jco", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("bundle", "my plugin.wasm", "-o", "./out dir", "--dry-run", "--json");

		expect(mockRunProcessHandoff).not.toHaveBeenCalled();
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

		expect(mockRunProcessHandoff).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "pnpm",
				args: expect.arrayContaining(["--name", "my-plugin"]),
			}),
			{ capture: true },
		);
		consoleSpy.mockRestore();
	});

	it("uses --name when provided", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("bundle", "my-plugin.wasm", "--name", "custom-name");

		expect(mockRunProcessHandoff).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "pnpm",
				args: expect.arrayContaining(["--name", "custom-name"]),
			}),
			{ capture: true },
		);
		consoleSpy.mockRestore();
	});

	it("captures bundle output in JSON mode", async () => {
		mockRunProcessHandoff.mockResolvedValue({
			exitCode: 0,
			stdout: "generated component\n",
			stderr: "jco warning\n",
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("bundle", "my-plugin.wasm", "--json");

		expect(mockRunProcessHandoff).toHaveBeenCalledWith(
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
		mockRunProcessHandoff.mockImplementation(() => {
			throw new Error("jco not found");
		});

		const { rendered, exitCode } = await renderNonJson("bundle", "bad-plugin.wasm");

		expect(exitCode).toBe(1); // ESSENTIAL
		expect(rendered).toContain(
			"Command: pnpm exec jco transpile bad-plugin.wasm",
		);
		expect(rendered).toContain("REFARM_PACKAGE_MANAGER=pnpm|npm|yarn|bun");
	});

	it("prints bundle failures as JSON without operator stderr", async () => {
		mockRunProcessHandoff.mockImplementation(() => {
			throw new Error("jco not found");
		});
		const originalExitCode = process.exitCode;
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await run("bundle", "bad-plugin.wasm", "--json");

		expect(mockRunProcessHandoff).toHaveBeenCalledWith(
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
