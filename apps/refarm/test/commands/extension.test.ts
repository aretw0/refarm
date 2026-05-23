import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
		expect(help).toContain("/reload in the refarm REPL");
	});

	it("prints runtime activation guidance when scaffolding an extension", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const tempDir = mkdtempSync(join(tmpdir(), "refarm-extension-test-"));
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
		expect(output).toContain("Activate: run '/reload'");
		expect(output).toContain("restart the Refarm runtime");
		expect(errorSpy).not.toHaveBeenCalled();

		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("builds a structured extension inventory", () => {
		const cwd = mkdtempSync(join(tmpdir(), "refarm-extension-cwd-"));
		const home = mkdtempSync(join(tmpdir(), "refarm-extension-home-"));
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
		const tempDir = mkdtempSync(join(tmpdir(), "refarm-extension-list-"));
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
		expect(output).toContain("refarm plugin status");
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
	});
});
