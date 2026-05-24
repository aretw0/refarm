import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenUrlCommand } from "../../src/commands/open-url.js";

describe("open-url command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("documents devcontainer browser handoff workflows", () => {
		const command = createOpenUrlCommand();
		let help = "";
		command.configureOutput({
			writeOut: (chunk) => {
				help += chunk;
			},
		});

		command.outputHelp();

		expect(help).toContain("refarm open-url https://platform.openai.com/auth");
		expect(help).toContain(
			"refarm open-url https://dash.cloudflare.com --dry-run",
		);
		expect(help).toContain(
			"refarm open-url https://dash.cloudflare.com --dry-run --json",
		);
		expect(help).toContain("REFARM_BROWSER_OPEN_COMMAND");
		expect(help).toContain("operator.openExternalLinks never");
		expect(help).toContain("devcontainer to the host browser");
		expect(help).toContain("flows headless and print URLs instead");
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

	it("prints opener candidates as JSON in dry-run mode", async () => {
		const open = vi.fn();
		const command = createOpenUrlCommand({ open });
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await command.parseAsync(
			["https://github.com/login/device", "--dry-run", "--json"],
			{ from: "user" },
		);

		expect(open).not.toHaveBeenCalled();
		const payload = JSON.parse(logs.join("\n")) as {
			command: string;
			url: string;
			dryRun: boolean;
			ok: boolean;
			candidates: unknown[];
		};
		expect(payload).toMatchObject({
			command: "open-url",
			url: "https://github.com/login/device",
			dryRun: true,
			ok: true,
		});
		expect(payload.candidates.length).toBeGreaterThan(0);
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

	it("prints successful opener result as JSON", async () => {
		const open = vi.fn().mockResolvedValue({
			url: "https://example.test/auth",
			candidate: {
				command: "code",
				args: ["--open-url", "https://example.test/auth"],
				display: "code --open-url https://example.test/auth",
			},
		});
		const command = createOpenUrlCommand({ open });
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await command.parseAsync(["https://example.test/auth", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(logs.join("\n")) as {
			ok: boolean;
			result: { candidate: { display: string } };
		};
		expect(payload).toMatchObject({
			ok: true,
			result: {
				candidate: { display: "code --open-url https://example.test/auth" },
			},
		});
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

	it("prints opener failures as JSON without stderr", async () => {
		const open = vi.fn().mockRejectedValue(new Error("no opener"));
		const command = createOpenUrlCommand({ open });
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["https://example.test/auth", "--json"], {
			from: "user",
		});

		expect(process.exitCode).toBe(1);
		expect(errorSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(logs.join("\n")) as {
			ok: boolean;
			error: string;
			nextAction: string;
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "no opener",
			nextAction: "open manually: https://example.test/auth",
		});
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});
});
