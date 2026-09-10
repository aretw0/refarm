import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extensionCommand } from "../../src/commands/plugin-local.js";
import { buildExtensionListReport } from "../../src/commands/plugin-scaffold.js";

describe("extension command", () => {
	it("documents deprecation + runtime reload behavior in help", () => {
		let help = "";
		extensionCommand.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		extensionCommand.outputHelp();

		// ADR-086 phase 4: help now points at the canonical `plugin` command.
		expect(help).toContain("Deprecated");
		expect(help).toContain("refarm plugin list --origin local");
		expect(help).toContain("refarm plugin install <path>");
		expect(help).toContain("Local plugins are loaded by the Refarm runtime");
		expect(help).toContain("refarm plugin reload @local/<name> --json");
		expect(help).toContain("/reload @local/<name>");
		expect(help).toContain("/r @local/<name>");
	});

	// REVIEW ROUND 1, IMPORTANT 3 (2026-08-26): this test used to PIN the defect it
	// should have caught — it asserted "Activate: refarm plugin reload ..." as correct
	// output, but `reload_plugin` (packages/tractor/src/lib.rs:1164) only affects a
	// plugin this runtime already loaded at boot (`plugin_paths`); a freshly scaffolded
	// id was never requested, so reload silently returns `false` and "restart the
	// runtime" does not put it there either. Now it asserts the true, corrected
	// first-line guidance and its order: the notice leads, the old reload/restart
	// framing is gone.
	it("prints the WASM/light-track notice first when scaffolding an extension, not stale reload guidance", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const tempDir = mkdtempSync(join(os.tmpdir(), "refarm-extension-test-"));
		const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);

		try {
			await extensionCommand
				.commands
				.find((command) => command.name() === "new")!
				.parseAsync(["my-tool"], { from: "user" });
		} finally {
			cwdSpy.mockRestore();
			rmSync(tempDir, { recursive: true, force: true });
		}

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Declare it before running it unsigned");
		expect(output).toContain("is designed and not built");
		expect(output).toContain("reloading it now does nothing — it is not an activation step");
		expect(output).not.toMatch(/Activate:.*reload/u);
		expect(output).not.toMatch(/Fallback:.*restart/u);
		// Order: the truth leads. The notice must appear before the reload caveat.
		expect(output.indexOf("Declare it before running it unsigned")).toBeLessThan(
			output.indexOf("not an activation step"),
		);
		expect(errorSpy).not.toHaveBeenCalled();

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("prints created extension metadata as JSON", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const tempDir = mkdtempSync(join(os.tmpdir(), "refarm-extension-json-"));
		const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);

		try {
			await extensionCommand
				.commands
				.find((command) => command.name() === "new")!
				.parseAsync(["my-tool", "--json"], { from: "user" });

			const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
				command: string;
				operation: string;
				ok: boolean;
				id: string;
				slug: string;
				name: string;
				version: string;
				dir: string;
				scope: string;
				indexPath: string;
				nextAction: string;
				nextActions: string[];
				nextCommand: string;
				nextCommands: string[];
			};
			expect(payload).toMatchObject({
				command: "extension",
				operation: "new",
				ok: true,
				id: "@local/my-tool",
				slug: "my-tool",
				name: "My Tool",
				version: "0.0.1",
				dir: join(tempDir, ".refarm", "extensions", "my-tool"),
				scope: "project",
				indexPath: join(tempDir, ".refarm", "extensions", "my-tool", "index.js"),
				nextActions: [
					"refarm plugin reload '@local/my-tool' --json",
					"restart the Refarm runtime",
					"inside refarm chat, run /reload @local/my-tool (or /r @local/my-tool)",
				],
				nextAction: "refarm plugin reload '@local/my-tool' --json",
				nextCommand: "refarm plugin reload '@local/my-tool' --json",
				nextCommands: [
					"refarm plugin reload '@local/my-tool' --json",
					"refarm extension list --json",
				],
			});
		} finally {
			cwdSpy.mockRestore();
			logSpy.mockRestore();
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("builds a structured extension inventory", () => {
		const cwd = mkdtempSync(join(os.tmpdir(), "refarm-extension-cwd-"));
		const home = mkdtempSync(join(os.tmpdir(), "refarm-extension-home-"));
		try {
			const projectExt = join(cwd, ".refarm", "extensions", "my-tool");
			const globalExt = join(home, ".refarm", "extensions", "global-tool");
			mkdirSync(projectExt, { recursive: true });
			mkdirSync(globalExt, { recursive: true });
			writeFileSync(
				join(projectExt, "ext.json"),
				JSON.stringify({
					id: "@local/my-tool",
					name: "My Tool",
					version: "0.0.1",
					capabilities: { provides: ["ai:respond"] },
				}),
			);
			writeFileSync(
				join(globalExt, "ext.json"),
				JSON.stringify({
					id: "@local/global-tool",
					name: "Global Tool",
					version: "0.0.2",
					capabilities: { provides: ["ai:respond"] },
				}),
			);

			expect(buildExtensionListReport(cwd, home)).toMatchObject({
				command: "extension",
				operation: "list",
				ok: true,
				extensions: [
					{
						id: "@local/my-tool",
						name: "My Tool",
						version: "0.0.1",
						dir: projectExt,
						scope: "project",
					},
					{
						id: "@local/global-tool",
						name: "Global Tool",
						version: "0.0.2",
						dir: globalExt,
						scope: "global",
					},
				],
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("prints extension inventory as JSON", async () => {
		const tempDir = mkdtempSync(join(os.tmpdir(), "refarm-extension-list-"));
		const extDir = join(tempDir, ".refarm", "extensions", "my-tool");
		const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			mkdirSync(extDir, { recursive: true });
			writeFileSync(
				join(extDir, "ext.json"),
				JSON.stringify({
					id: "@local/my-tool",
					name: "My Tool",
					version: "0.0.1",
					capabilities: { provides: ["ai:respond"] },
				}),
			);

			await extensionCommand
				.commands
				.find((command) => command.name() === "list")!
				.parseAsync(["--json"], { from: "user" });

			const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
				command: string;
				operation: string;
				ok: boolean;
				nextAction: string | null;
				nextActions: string[];
				nextCommand: string | null;
				nextCommands: string[];
				extensions: Array<{ id: string; scope: string }>;
			};
			expect(payload.command).toBe("extension");
			expect(payload.operation).toBe("list");
			expect(payload.ok).toBe(true);
			expect(payload.nextAction).toBeNull();
			expect(payload.nextActions).toEqual([]);
			expect(payload.nextCommand).toBeNull();
			expect(payload.nextCommands).toEqual([]);
			expect(payload.extensions).toEqual([
				expect.objectContaining({
					id: "@local/my-tool",
					scope: "project",
				}),
			]);
		} finally {
			cwdSpy.mockRestore();
			logSpy.mockRestore();
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("explains the manual plugin packaging path for publish", async () => {
		process.exitCode = undefined;
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await extensionCommand
			.commands
			.find((command) => command.name() === "publish")!
			.parseAsync(["my-tool"], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("not automated yet");
		expect(output).toContain("refarm plugin bundle");
		expect(output).toContain("refarm plugin reload '@local/my-tool' --json");
		expect(output).toContain("refarm plugin status");
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
	});

	it("moves an extension and prints save result as JSON", async () => {
		const tempDir = mkdtempSync(join(os.tmpdir(), "refarm-extension-save-cwd-"));
		const homeDir = mkdtempSync(join(os.tmpdir(), "refarm-extension-save-home-"));
		const extDir = join(tempDir, ".refarm", "extensions", "my-tool");
		const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const previousHome = process.env.HOME;
		const previousRefarmHome = process.env.REFARM_HOME;
		try {
			process.env.HOME = homeDir;
			process.env.REFARM_HOME = join(homeDir, ".refarm");
			mkdirSync(extDir, { recursive: true });
			writeFileSync(
				join(extDir, "ext.json"),
				JSON.stringify({
					id: "@local/my-tool",
					name: "My Tool",
					version: "0.0.1",
					capabilities: { provides: ["ai:respond"] },
				}),
			);

			await extensionCommand
				.commands
				.find((command) => command.name() === "save")!
				.parseAsync(["my-tool", "--global", "--json"], { from: "user" });

			const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
				ok: boolean;
				action: string;
				fromScope: string;
				toScope: string;
				destinationDir: string;
				nextCommand: string;
			};
			expect(payload).toMatchObject({
				ok: true,
				action: "save",
				fromScope: "project",
				toScope: "global",
				destinationDir: join(homeDir, ".refarm", "extensions", "my-tool"),
				nextCommand: "refarm extension list --json",
			});
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
			if (previousRefarmHome === undefined) {
				delete process.env.REFARM_HOME;
			} else {
				process.env.REFARM_HOME = previousRefarmHome;
			}
			cwdSpy.mockRestore();
			logSpy.mockRestore();
			rmSync(tempDir, { recursive: true, force: true });
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("prints missing save scope as JSON", async () => {
		process.exitCode = undefined;
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await extensionCommand
			.commands
			.find((command) => command.name() === "save")!
			.parseAsync(["my-tool", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "missing-scope",
		});
		expect(payload.nextActions).toContain("refarm extension save my-tool --global");
		expect(payload.nextCommand).toBe(
			"refarm extension save 'my-tool' --global --json",
		);
		expect(payload.nextCommands).toContain(
			"refarm extension save 'my-tool' --local --json",
		);
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("prints invalid extension names as actionable JSON", async () => {
		process.exitCode = undefined;
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await extensionCommand
			.commands
			.find((command) => command.name() === "save")!
			.parseAsync(["Bad_Name", "--global", "--json"], { from: "user" });

		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			nextAction: string;
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "invalid-extension-name",
			nextAction: "refarm extension save my-tool --global",
			nextCommand: "refarm extension save my-tool --global --json",
		});
		expect(payload.nextCommands).toContain(
			"refarm extension save my-tool --local --json",
		);
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("prints publish plan as JSON", async () => {
		process.exitCode = undefined;
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await extensionCommand
			.commands
			.find((command) => command.name() === "publish")!
			.parseAsync(["my-tool", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			status: string;
			nextAction: string;
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "extension-publish-manual",
			status: "manual",
			nextAction: "Package the extension as a WASM plugin before bundling.",
		});
		expect(payload.nextActions).toContain("refarm plugin reload '@local/my-tool' --json");
		expect(payload.nextActions).not.toContain("refarm plugin bundle <plugin.wasm>");
		expect(payload.nextCommand).toBe("refarm extension list --json");
		expect(payload.nextCommands).toContain("refarm plugin reload '@local/my-tool' --json");
		expect(payload.nextCommands).toContain("refarm plugin status --json");
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
	});
});
