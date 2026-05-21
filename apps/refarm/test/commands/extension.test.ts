import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extensionCommand } from "../../src/commands/extension.js";

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
});
