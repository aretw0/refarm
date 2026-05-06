import { describe, expect, it, vi, beforeEach } from "vitest";
import { createOpenUrlCommand } from "../../src/commands/open-url.js";

describe("open-url command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("prints opener candidates in dry-run mode", async () => {
		const open = vi.fn();
		const command = createOpenUrlCommand({ open });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["https://github.com/login/device", "--dry-run"], {
			from: "user",
		});

		expect(open).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("[dry-run] would open browser URL"),
		);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("candidate:"));
		logSpy.mockRestore();
	});

	it("opens a URL through injected host browser primitive", async () => {
		const open = vi.fn().mockResolvedValue({
			url: "https://example.test/auth",
			candidate: {
				command: "code",
				args: ["--open-url", "https://example.test/auth"],
				display: "code --open-url https://example.test/auth",
			},
		});
		const command = createOpenUrlCommand({ open });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["https://example.test/auth"], { from: "user" });

		expect(open).toHaveBeenCalledWith("https://example.test/auth");
		expect(logSpy).toHaveBeenCalledWith(
			"Opened via: code --open-url https://example.test/auth",
		);
		logSpy.mockRestore();
	});

	it("prints manual fallback instructions when open fails", async () => {
		const open = vi.fn().mockRejectedValue(new Error("no opener"));
		const command = createOpenUrlCommand({ open });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["https://example.test/auth"], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Failed to open browser URL"),
		);
		expect(errorSpy).toHaveBeenCalledWith(
			"Open this URL manually: https://example.test/auth",
		);
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});
});
