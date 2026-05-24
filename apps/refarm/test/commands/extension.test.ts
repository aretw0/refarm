import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	buildExtensionListReport,
	extensionCommand,
} from "../../src/commands/extension.js";

describe("extension command", () => {
	it("documents runtime reload behavior in help", () => {
		let help = "";
		extensionCommand.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		extensionCommand.outputHelp();

		expect(help).toContain("Local extensions are loaded by the Refarm runtime");
		expect(help).toContain("refarm extension save my-tool --global --json");
		expect(help).toContain("refarm extension publish my-tool --json");
		expect(help).toContain("refarm plugin reload @local/<name> --json");
		expect(help).toContain("/reload @local/<name>");
	});

	it("prints runtime activation guidance when scaffolding an extension", async () => {
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
		expect(output).toContain("Activate: refarm plugin reload '@local/my-tool' --json");
		expect(output).toContain("restart the Refarm runtime");
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
				id: string;
				slug: string;
				name: string;
				version: string;
				dir: string;
				scope: string;
				indexPath: string;
				nextActions: string[];
				nextCommand: string;
				nextCommands: string[];
			};
			expect(payload).toMatchObject({
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
					"inside refarm chat, run /reload @local/my-tool",
				],
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
				extensions: Array<{ id: string; scope: string }>;
			};
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
		try {
			process.env.HOME = homeDir;
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
		expect(payload.nextCommand).toBe("refarm extension save 'my-tool' --global");
		expect(payload.nextCommands).toContain(
			"refarm extension save 'my-tool' --local",
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
			nextCommand: "refarm extension save my-tool --global",
		});
		expect(payload.nextCommands).toContain("refarm extension save my-tool --local");
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
			nextAction: "refarm plugin bundle <plugin.wasm>",
		});
		expect(payload.nextActions).toContain("refarm plugin reload '@local/my-tool' --json");
		expect(payload.nextCommand).toBe("refarm extension list --json");
		expect(payload.nextCommands).toContain("refarm plugin reload '@local/my-tool' --json");
		expect(payload.nextCommands).toContain("refarm plugin status --json");
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
	});
});
