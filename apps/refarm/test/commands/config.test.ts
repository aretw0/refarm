import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfigCommand } from "../../src/commands/config.js";
import { OPEN_EXTERNAL_LINKS_ENV_VAR } from "../../src/utils/open-external-links.js";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "refarm-config-"));
}

const EMPTY_JSON_HANDOFF = {
	ok: true,
	nextAction: null,
	nextActions: [],
	nextCommand: null,
	nextCommands: [],
};

function configIdentity(operation: string) {
	return {
		command: "config",
		operation,
	};
}

function configGetHandoff(key: string, local = false) {
	const nextCommand = `refarm config get ${key} --json${local ? " --local" : ""}`;
	return {
		ok: true,
		nextAction: null,
		nextActions: [],
		nextCommand,
		nextCommands: [nextCommand],
	};
}

describe("config command", () => {
	let cwd: string;
	let home: string;
	let originalAutostart: string | undefined;
	let originalRuntimeAutostart: string | undefined;
	let originalOpenExternalLinks: string | undefined;
	let originalSidecarUrl: string | undefined;
	let originalTractorEngine: string | undefined;

	beforeEach(() => {
		cwd = makeTempDir();
		home = makeTempDir();
		originalAutostart = process.env.REFARM_FARMHAND_AUTOSTART;
		originalRuntimeAutostart = process.env.REFARM_RUNTIME_AUTOSTART;
		originalOpenExternalLinks = process.env[OPEN_EXTERNAL_LINKS_ENV_VAR];
		originalSidecarUrl = process.env.REFARM_SIDECAR_URL;
		originalTractorEngine = process.env.REFARM_TRACTOR_ENGINE;
		delete process.env.REFARM_FARMHAND_AUTOSTART;
		delete process.env.REFARM_RUNTIME_AUTOSTART;
		delete process.env[OPEN_EXTERNAL_LINKS_ENV_VAR];
		delete process.env.REFARM_SIDECAR_URL;
		delete process.env.REFARM_TRACTOR_ENGINE;
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		if (originalAutostart === undefined) {
			delete process.env.REFARM_FARMHAND_AUTOSTART;
		} else {
			process.env.REFARM_FARMHAND_AUTOSTART = originalAutostart;
		}
		if (originalRuntimeAutostart === undefined) {
			delete process.env.REFARM_RUNTIME_AUTOSTART;
		} else {
			process.env.REFARM_RUNTIME_AUTOSTART = originalRuntimeAutostart;
		}
		if (originalOpenExternalLinks === undefined) {
			delete process.env[OPEN_EXTERNAL_LINKS_ENV_VAR];
		} else {
			process.env[OPEN_EXTERNAL_LINKS_ENV_VAR] = originalOpenExternalLinks;
		}
		if (originalSidecarUrl === undefined) {
			delete process.env.REFARM_SIDECAR_URL;
		} else {
			process.env.REFARM_SIDECAR_URL = originalSidecarUrl;
		}
		if (originalTractorEngine === undefined) {
			delete process.env.REFARM_TRACTOR_ENGINE;
		} else {
			process.env.REFARM_TRACTOR_ENGINE = originalTractorEngine;
		}
		vi.restoreAllMocks();
		process.exitCode = undefined;
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

	it("sets runtime autostart mode", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["set", "runtime.autostart", "always"], {
			from: "user",
		});

		const saved = JSON.parse(
			fs.readFileSync(path.join(home, ".refarm", "config.json"), "utf-8"),
		) as { autostart?: string };
		expect(saved.autostart).toBe("always");
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("runtime.autostart=always"),
		);
	});

	it("prints persisted config value as JSON", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["set", "runtime.autostart", "always", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			...configIdentity("set"),
			key: "runtime.autostart",
			value: "always",
			path: path.join(home, ".refarm", "config.json"),
			scope: "home",
			...configGetHandoff("runtime.autostart"),
		});
	});

	it("prints local persisted config value as JSON", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(
			["set", "operator.openExternalLinks", "never", "--local", "--json"],
			{ from: "user" },
		);

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			...configIdentity("set"),
			key: "operator.openExternalLinks",
			value: "never",
			path: path.join(cwd, ".refarm", "config.json"),
			scope: "local",
			...configGetHandoff("operator.openExternalLinks", true),
		});
	});

	it("applies local coding runtime profile as JSON", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["profile", "coding", "--local", "--json"], {
			from: "user",
		});

		const configPath = path.join(cwd, ".refarm", "config.json");
		const saved = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, string>;
		expect(saved).toMatchObject({
			MODEL_HISTORY_TURNS: "20",
			MODEL_TOOL_CALL_MAX_ITER: "20",
			MODEL_STREAM_RESPONSES: "1",
		});
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			...configIdentity("profile"),
			profile: "coding",
			path: configPath,
			scope: "local",
			values: {
				MODEL_HISTORY_TURNS: "20",
				MODEL_TOOL_CALL_MAX_ITER: "20",
				MODEL_STREAM_RESPONSES: "1",
			},
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: [
				"refarm runtime ensure --wait --next-command",
				"refarm config --json",
			],
		});
	});

	it("rejects unknown config profiles", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["profile", "python"], { from: "user" });

		const errors = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(errors).toContain("Unknown config profile: python");
		expect(process.exitCode).toBe(1);
		expect(fs.existsSync(path.join(home, ".refarm", "config.json"))).toBe(false);
	});

	it("marks persisted legacy config keys in JSON output", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["set", "farmhand.autostart", "always", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			...configIdentity("set"),
			key: "farmhand.autostart",
			value: "always",
			path: path.join(home, ".refarm", "config.json"),
			scope: "home",
			legacy: true,
			...configGetHandoff("farmhand.autostart"),
		});
	});

	it("unsets persisted config values", async () => {
		fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ autostart: "always" }),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["unset", "runtime.autostart"], {
			from: "user",
		});

		const saved = JSON.parse(
			fs.readFileSync(path.join(home, ".refarm", "config.json"), "utf-8"),
		) as { autostart?: string };
		expect(saved.autostart).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("unset runtime.autostart"),
		);
	});

	it("prints unset config result as JSON", async () => {
		fs.mkdirSync(path.join(cwd, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".refarm", "config.json"),
			JSON.stringify({ operator: { openExternalLinks: "never" } }),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(
			["unset", "operator.openExternalLinks", "--local", "--json"],
			{ from: "user" },
		);

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			...configIdentity("unset"),
			key: "operator.openExternalLinks",
			path: path.join(cwd, ".refarm", "config.json"),
			scope: "local",
			removed: true,
			...configGetHandoff("operator.openExternalLinks", true),
		});
	});

	it("reports unset misses without creating config files", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["unset", "tractor.engine", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			...configIdentity("unset"),
			key: "tractor.engine",
			path: path.join(home, ".refarm", "config.json"),
			scope: "home",
			removed: false,
			...configGetHandoff("tractor.engine"),
		});
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
		expect(output).toContain("legacy key; prefer runtime.autostart");
	});

	it("prints effective runtime autostart mode", async () => {
		fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ autostart: "never" }),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["get", "runtime.autostart"], {
			from: "user",
		});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("runtime.autostart=never");
	});

	it("lets local runtime autostart override home preference", async () => {
		fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
		fs.mkdirSync(path.join(cwd, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ autostart: "always" }),
			"utf-8",
		);
		fs.writeFileSync(
			path.join(cwd, ".refarm", "config.json"),
			JSON.stringify({ autostart: "never" }),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["get", "runtime.autostart"], {
			from: "user",
		});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("runtime.autostart=never");
		expect(output).toContain(path.join(cwd, ".refarm", "config.json"));
	});

	it("prints effective config as JSON when run without a subcommand", async () => {
		fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ autostart: "always" }),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			command: string;
			operation: string;
			values: Array<{ key: string; value: string; source: string }>;
		};
		expect(payload.command).toBe("config");
		expect(payload.operation).toBe("summary");
		expect(payload.values).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "runtime.autostart",
					value: "always",
					source: path.join(home, ".refarm", "config.json"),
				}),
				expect.objectContaining({
					key: "runtime.sidecarUrl",
					value: "http://127.0.0.1:42001",
					source: "default",
				}),
				expect.objectContaining({
					key: "operator.openExternalLinks",
					value: "auto",
					source: "default",
				}),
				expect.objectContaining({
					key: "tractor.engine",
					value: "auto",
					source: "default",
				}),
			]),
		);
	});

	it("prints effective config value as JSON", async () => {
		fs.mkdirSync(path.join(cwd, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".refarm", "config.json"),
			JSON.stringify({ autostart: "never" }),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["get", "runtime.autostart", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			...configIdentity("get"),
			key: "runtime.autostart",
			value: "never",
			source: path.join(cwd, ".refarm", "config.json"),
			...EMPTY_JSON_HANDOFF,
		});
	});

	it("marks legacy config keys in JSON output", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["get", "farmhand.autostart", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			...configIdentity("get"),
			key: "farmhand.autostart",
			value: "ask",
			source: "default",
			legacy: true,
			...EMPTY_JSON_HANDOFF,
		});
	});

	it("prints a guide when run without a subcommand", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync([], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm config");
		expect(output).toContain("runtime.autostart=ask");
		expect(output).toContain("runtime.sidecarUrl=http://127.0.0.1:42001");
		expect(output).toContain("operator.openExternalLinks=auto");
		expect(output).toContain("tractor.engine=auto");
		expect(output).toContain("Future: running this command without arguments can become interactive");
	});

	it("prints effective config sources when run without a subcommand", async () => {
		fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
		fs.mkdirSync(path.join(cwd, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({
				autostart: "always",
				operator: { openExternalLinks: "never" },
			}),
			"utf-8",
		);
		fs.writeFileSync(
			path.join(cwd, ".refarm", "config.json"),
			JSON.stringify({ tractor: { engine: "rust" } }),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync([], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("runtime.autostart=always");
		expect(output).toContain(path.join(home, ".refarm", "config.json"));
		expect(output).toContain("operator.openExternalLinks=never");
		expect(output).toContain("tractor.engine=rust");
		expect(output).toContain(path.join(cwd, ".refarm", "config.json"));
	});

	it("documents config get keys and precedence", () => {
		const root = command();
		const getCommand = root.commands.find((subcommand) => subcommand.name() === "get");
		let help = "";
		getCommand?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		getCommand?.outputHelp();

		expect(help).toContain("refarm config get runtime.autostart");
		expect(help).toContain("tractor.engine  auto | rust | ts");
		expect(help).toContain("farmhand.autostart  ask | always | never");
		expect(help).toContain("legacy; prefer runtime.autostart");
		expect(help).toContain("REFARM_OPEN_EXTERNAL_LINKS");
	});

	it("documents config set examples and local scope", () => {
		const root = command();
		const setCommand = root.commands.find((subcommand) => subcommand.name() === "set");
		let help = "";
		setCommand?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		setCommand?.outputHelp();

		expect(help).toContain("refarm config set runtime.autostart always");
		expect(help).toContain("refarm config set tractor.engine rust");
		expect(help).toContain("farmhand.autostart  ask | always | never");
		expect(help).toContain("legacy; prefer runtime.autostart");
		expect(help).toContain("repository-specific operator preferences");
		expect(help).toContain("REFARM_RUNTIME_AUTOSTART");
	});

	it("documents config profiles", () => {
		const root = command();
		const profileCommand = root.commands.find((subcommand) => subcommand.name() === "profile");
		let help = "";
		profileCommand?.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		profileCommand?.outputHelp();

		expect(help).toContain("refarm config profile coding --local");
		expect(help).toContain("MODEL_HISTORY_TURNS=20");
		expect(help).toContain("MODEL_TOOL_CALL_MAX_ITER=20");
		expect(help).toContain("MODEL_STREAM_RESPONSES=1");
		expect(help).toContain("Restart or ensure the runtime");
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

	it("sets runtime sidecar URL preference", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(
			["set", "runtime.sidecarUrl", "http://127.0.0.1:52001/"],
			{ from: "user" },
		);

		const saved = JSON.parse(
			fs.readFileSync(path.join(home, ".refarm", "config.json"), "utf-8"),
		) as { runtime?: { sidecarUrl?: string } };
		expect(saved.runtime?.sidecarUrl).toBe("http://127.0.0.1:52001");
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("runtime.sidecarUrl=http://127.0.0.1:52001"),
		);
	});

	it("lets local runtime sidecar URL override home preference", async () => {
		fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
		fs.mkdirSync(path.join(cwd, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ runtime: { sidecarUrl: "http://127.0.0.1:42001" } }),
			"utf-8",
		);
		fs.writeFileSync(
			path.join(cwd, ".refarm", "config.json"),
			JSON.stringify({ runtime: { sidecarUrl: "http://127.0.0.1:52001" } }),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["get", "runtime.sidecarUrl"], {
			from: "user",
		});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("runtime.sidecarUrl=http://127.0.0.1:52001");
		expect(output).toContain(path.join(cwd, ".refarm", "config.json"));
	});

	it("lets env override runtime sidecar URL preference", async () => {
		fs.mkdirSync(path.join(cwd, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".refarm", "config.json"),
			JSON.stringify({ runtime: { sidecarUrl: "http://127.0.0.1:52001" } }),
			"utf-8",
		);
		process.env.REFARM_SIDECAR_URL = "http://127.0.0.1:62001/";
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["get", "runtime.sidecarUrl"], {
			from: "user",
		});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("runtime.sidecarUrl=http://127.0.0.1:62001");
		expect(output).toContain("source=env:REFARM_SIDECAR_URL");
	});

	it("lets local external-link mode override home preference", async () => {
		fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
		fs.mkdirSync(path.join(cwd, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ operator: { openExternalLinks: "auto" } }),
			"utf-8",
		);
		fs.writeFileSync(
			path.join(cwd, ".refarm", "config.json"),
			JSON.stringify({ operator: { openExternalLinks: "never" } }),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["get", "operator.openExternalLinks"], {
			from: "user",
		});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("operator.openExternalLinks=never");
		expect(output).toContain(path.join(cwd, ".refarm", "config.json"));
	});

	it("lets env override external-link config", async () => {
		fs.mkdirSync(path.join(cwd, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".refarm", "config.json"),
			JSON.stringify({ operator: { openExternalLinks: "never" } }),
			"utf-8",
		);
		process.env[OPEN_EXTERNAL_LINKS_ENV_VAR] = "auto";
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["get", "operator.openExternalLinks"], {
			from: "user",
		});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("operator.openExternalLinks=auto");
		expect(output).toContain("source=env:REFARM_OPEN_EXTERNAL_LINKS");
	});

	it("warns when invalid env overrides are ignored", async () => {
		fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ autostart: "never" }),
			"utf-8",
		);
		process.env.REFARM_RUNTIME_AUTOSTART = "sometimes";
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["get", "runtime.autostart"], {
			from: "user",
		});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		const errors = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("runtime.autostart=never");
		expect(output).toContain(path.join(home, ".refarm", "config.json"));
		expect(errors).toContain("Ignored invalid REFARM_RUNTIME_AUTOSTART=sometimes");
		expect(errors).toContain("Use: ask, always, never");
	});

	it("warns about invalid summary env overrides", async () => {
		process.env[OPEN_EXTERNAL_LINKS_ENV_VAR] = "browser";
		process.env.REFARM_SIDECAR_URL = "file:///tmp/refarm.sock";
		process.env.REFARM_TRACTOR_ENGINE = "python";
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync([], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		const errors = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("operator.openExternalLinks=auto");
		expect(output).toContain("tractor.engine=auto");
		expect(errors).toContain("Ignored invalid REFARM_OPEN_EXTERNAL_LINKS=browser");
		expect(errors).toContain("Ignored invalid REFARM_SIDECAR_URL=file:///tmp/refarm.sock");
		expect(errors).toContain("Ignored invalid REFARM_TRACTOR_ENGINE=python");
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

	it("lets env override tractor engine preference", async () => {
		fs.mkdirSync(path.join(cwd, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".refarm", "config.json"),
			JSON.stringify({ tractor: { engine: "rust" } }),
			"utf-8",
		);
		process.env.REFARM_TRACTOR_ENGINE = "ts";
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["get", "tractor.engine"], {
			from: "user",
		});

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("tractor.engine=ts");
		expect(output).toContain("source=env:REFARM_TRACTOR_ENGINE");
	});

	it("rejects invalid autostart modes", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["set", "runtime.autostart", "sometimes"], {
			from: "user",
		});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Invalid runtime.autostart"),
		);
		expect(process.exitCode).toBe(1);
	});

	it("rejects unknown config keys without exiting the process", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["get", "runtime.provider"], {
			from: "user",
		});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Unknown config key"),
		);
		expect(process.exitCode).toBe(1);
	});

	it("rejects invalid tractor engine preferences", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["set", "tractor.engine", "python"], {
			from: "user",
		});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Invalid tractor.engine"),
		);
		expect(process.exitCode).toBe(1);
	});

	it("rejects invalid runtime sidecar URLs", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["set", "runtime.sidecarUrl", "file:///tmp/socket"], {
			from: "user",
		});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Invalid runtime.sidecarUrl"),
		);
		expect(process.exitCode).toBe(1);
	});
});
