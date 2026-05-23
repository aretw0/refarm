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
	mockExecFileSync,
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
		mockExecFileSync: vi.fn(),
	};
});

vi.mock("node:fs", () => ({
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

vi.mock("node:child_process", () => ({ execFileSync: mockExecFileSync }));

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
		expect(help).toContain("/reload @refarm/pi-agent");
		expect(help).toContain("refarm runtime start --wait");
		expect(help).toContain("refarm doctor");
		expect(help).toContain("refarm ask preflights pi-agent");
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
		expect(help).toContain("/reload @refarm/pi-agent");
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
		mockReadFileSync.mockReturnValue(JSON.stringify({ version: "0.4.1" }));
		mockReadFile.mockResolvedValue("0.4.1"); // sentinel matches

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("update"); // update = install with force=false

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("already up-to-date"),
		);
		expect(mockCopyFileSync).not.toHaveBeenCalled();
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
		expect(output).not.toContain("pi-agent is not loaded");
		consoleSpy.mockRestore();
	});

	it("guides when pi-agent is installed but not loaded", async () => {
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
		expect(output).toContain("pi-agent is not loaded");
		expect(output).toContain("refarm plugin install");
		expect(output).toContain("then run /reload @refarm/pi-agent");
		expect(output).toContain("refarm ask hello");
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
			expect.stringContaining("refarm runtime start --wait"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("refarm runtime status"),
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
		mockExecFileSync.mockReturnValue(undefined);
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

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"pnpm",
			expect.arrayContaining(["exec", "jco", "transpile", "my-plugin.wasm", "-o", "./out"]),
			expect.objectContaining({ stdio: "inherit" }),
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
		expect(help).toContain("runs jco through the detected package manager");
		expect(help).toContain("Refarm maps this to pnpm exec, npm exec --, yarn, or bun x");
		expect(help).toContain("based on the project packageManager field or lockfile");
		expect(help).toContain("pnpm|npm|yarn|bun");
	});

	it("derives plugin name from filename when --name not provided", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("bundle", "my-plugin.wasm");

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"pnpm",
			expect.arrayContaining(["--name", "my-plugin"]),
			expect.any(Object),
		);
		consoleSpy.mockRestore();
	});

	it("uses --name when provided", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await run("bundle", "my-plugin.wasm", "--name", "custom-name");

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"pnpm",
			expect.arrayContaining(["--name", "custom-name"]),
			expect.any(Object),
		);
		consoleSpy.mockRestore();
	});

	it("sets process.exitCode = 1 when jco fails", async () => {
		mockExecFileSync.mockImplementation(() => {
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
});
