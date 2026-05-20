import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfigCommand } from "../../src/commands/config.js";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "refarm-config-"));
}

describe("config command", () => {
	let cwd: string;
	let home: string;
	let originalAutostart: string | undefined;

	beforeEach(() => {
		cwd = makeTempDir();
		home = makeTempDir();
		originalAutostart = process.env.REFARM_FARMHAND_AUTOSTART;
		delete process.env.REFARM_FARMHAND_AUTOSTART;
		vi.clearAllMocks();
	});

	afterEach(() => {
		if (originalAutostart === undefined) {
			delete process.env.REFARM_FARMHAND_AUTOSTART;
		} else {
			process.env.REFARM_FARMHAND_AUTOSTART = originalAutostart;
		}
		vi.restoreAllMocks();
	});

	function command() {
		return createConfigCommand({
			cwd: () => cwd,
			home: () => home,
		});
	}

	it("sets home farmhand autostart mode", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["set", "farmhand.autostart", "always"], {
			from: "user",
		});

		const saved = JSON.parse(
			fs.readFileSync(path.join(home, ".refarm", "config.json"), "utf-8"),
		) as { autostart?: string };
		expect(saved.autostart).toBe("always");
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("farmhand.autostart=always"),
		);
	});

	it("sets local farmhand autostart mode", async () => {
		await command().parseAsync(
			["set", "farmhand.autostart", "never", "--local"],
			{ from: "user" },
		);

		const saved = JSON.parse(
			fs.readFileSync(path.join(cwd, ".refarm", "config.json"), "utf-8"),
		) as { autostart?: string };
		expect(saved.autostart).toBe("never");
		expect(fs.existsSync(path.join(home, ".refarm", "config.json"))).toBe(false);
	});

	it("prints effective home autostart mode", async () => {
		fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ autostart: "never" }),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["get", "farmhand.autostart"], {
			from: "user",
		});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("farmhand.autostart=never");
	});

	it("prints a guide when run without a subcommand", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync([], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm config");
		expect(output).toContain("interactive config is reserved");
	});

	it("sets operator external-link mode", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["set", "operator.openExternalLinks", "never"], {
			from: "user",
		});

		const saved = JSON.parse(
			fs.readFileSync(path.join(home, ".refarm", "config.json"), "utf-8"),
		) as { operator?: { openExternalLinks?: string } };
		expect(saved.operator?.openExternalLinks).toBe("never");
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("operator.openExternalLinks=never"),
		);
	});

	it("sets tractor engine preference", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["set", "tractor.engine", "rust"], {
			from: "user",
		});

		const saved = JSON.parse(
			fs.readFileSync(path.join(home, ".refarm", "config.json"), "utf-8"),
		) as { tractor?: { engine?: string } };
		expect(saved.tractor?.engine).toBe("rust");
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("tractor.engine=rust"),
		);
	});

	it("prints default tractor engine preference", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["get", "tractor.engine"], {
			from: "user",
		});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("tractor.engine=auto");
		expect(output).toContain("source=default");
	});

	it("rejects invalid autostart modes", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(((code?: string | number | null | undefined) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

		await expect(
			command().parseAsync(["set", "farmhand.autostart", "sometimes"], {
				from: "user",
			}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Invalid farmhand.autostart"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("rejects invalid tractor engine preferences", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(((code?: string | number | null | undefined) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

		await expect(
			command().parseAsync(["set", "tractor.engine", "python"], {
				from: "user",
			}),
		).rejects.toThrow("exit:1");

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Invalid tractor.engine"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
