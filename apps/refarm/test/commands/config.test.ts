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

/** A mutation's handoff: read the value back, and then read the RECORD of the change — the
 *  record is only sovereignty if the operator is pointed at where to find it. */
function configMutationHandoff(key: string, local = false) {
	const nextCommand = `refarm config get ${key} --json${local ? " --local" : ""}`;
	return {
		ok: true,
		nextAction: null,
		nextActions: [],
		nextCommand,
		nextCommands: [nextCommand, `refarm config history --json${local ? " --local" : ""}`],
	};
}

/** A fixed clock, so a record id (`<requestId>#<decidedAt>`) is a stable string a test can
 *  assert exactly rather than a shape it can only pattern-match. */
const RECORDED_AT = "2026-07-30T12:00:00.000Z";

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
		return createConfigCommand(
			{
				cwd: () => cwd,
				home: () => home,
			},
			{ now: () => RECORDED_AT, decidedBy: "op", host: "torre" },
		);
	}

	it("rejects the removed farmhand autostart key on set", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["set", "farmhand.autostart", "always"], {
			from: "user",
		});

		const errors = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(errors).toContain("Unknown config key: farmhand.autostart");
		expect(process.exitCode).toBe(1);
		expect(fs.existsSync(path.join(home, ".refarm", "config.json"))).toBe(false);
	});

	it("rejects the removed farmhand autostart key on set --local", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["set", "farmhand.autostart", "never", "--local"], { from: "user" });

		const errors = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(errors).toContain("Unknown config key: farmhand.autostart");
		expect(process.exitCode).toBe(1);
		expect(fs.existsSync(path.join(cwd, ".refarm", "config.json"))).toBe(false);
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
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("runtime.autostart=always"));
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
			recordId: `config:home:runtime.autostart#${RECORDED_AT}`,
			...configMutationHandoff("runtime.autostart"),
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
			recordId: `config:local:operator.openExternalLinks#${RECORDED_AT}`,
			...configMutationHandoff("operator.openExternalLinks", true),
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
			nextCommands: ["refarm runtime ensure --wait --next-command", "refarm config --json"],
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

	it("ignores the removed farmhand autostart env override", async () => {
		process.env.REFARM_FARMHAND_AUTOSTART = "never";
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["get", "runtime.autostart", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			...configIdentity("get"),
			key: "runtime.autostart",
			value: "ask",
			source: "default",
			...EMPTY_JSON_HANDOFF,
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
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("unset runtime.autostart"));
	});

	it("prints unset config result as JSON", async () => {
		fs.mkdirSync(path.join(cwd, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".refarm", "config.json"),
			JSON.stringify({ operator: { openExternalLinks: "never" } }),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(["unset", "operator.openExternalLinks", "--local", "--json"], {
			from: "user",
		});

		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			...configIdentity("unset"),
			key: "operator.openExternalLinks",
			path: path.join(cwd, ".refarm", "config.json"),
			scope: "local",
			removed: true,
			recordId: `config:local:operator.openExternalLinks#${RECORDED_AT}`,
			...configMutationHandoff("operator.openExternalLinks", true),
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
			// Nothing was set, so nothing changed, so nothing was recorded. A trail full of
			// entries whose undo restores a file to itself is noise dressed as memory.
			recordId: null,
			...configGetHandoff("tractor.engine"),
		});
		expect(fs.existsSync(path.join(home, ".refarm", "config.json"))).toBe(false);
		expect(fs.existsSync(path.join(home, ".refarm", "operations.json"))).toBe(false);
	});

	it("rejects the removed farmhand autostart key on get", async () => {
		fs.mkdirSync(path.join(home, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".refarm", "config.json"),
			JSON.stringify({ autostart: "never" }),
			"utf-8",
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["get", "farmhand.autostart"], {
			from: "user",
		});

		const errors = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(errors).toContain("Unknown config key: farmhand.autostart");
		expect(process.exitCode).toBe(1);
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

	it("rejects the removed farmhand autostart key on get --json — with an envelope", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["get", "farmhand.autostart", "--json"], {
			from: "user",
		});

		// It used to print the refusal as two red lines on stderr and NOTHING on stdout, so
		// a `--json` consumer got exit 1 and no envelope to read it from.
		const envelope = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			command: string;
			operation: string;
			error: string;
			message: string;
			nextCommand: string | null;
			nextCommands: string[];
		};
		expect(envelope.ok).toBe(false);
		expect(envelope.command).toBe("config");
		expect(envelope.operation).toBe("get");
		expect(envelope.error).toBe("unknown-config-key");
		expect(envelope.message).toContain("Unknown config key: farmhand.autostart");
		expect(envelope.nextCommands.length).toBeGreaterThan(0);
		expect(process.exitCode).toBe(1);
	});

	it("prints the same refusal as one calm line, with no --json", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["get", "farmhand.autostart"], { from: "user" });

		const errors = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(errors).toContain("Unknown config key: farmhand.autostart");
		expect(process.exitCode).toBe(1);
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
		expect(output).toContain(
			"Future: running this command without arguments can become interactive",
		);
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
		expect(help).not.toContain("farmhand.autostart");
		expect(help).not.toContain("legacy; prefer runtime.autostart");
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
		expect(help).not.toContain("farmhand.autostart");
		expect(help).not.toContain("legacy; prefer runtime.autostart");
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

		await command().parseAsync(["set", "runtime.sidecarUrl", "http://127.0.0.1:52001/"], {
			from: "user",
		});

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
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("tractor.engine=rust"));
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

		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid runtime.autostart"));
		expect(process.exitCode).toBe(1);
	});

	it("rejects unknown config keys without exiting the process", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["get", "runtime.provider"], {
			from: "user",
		});

		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown config key"));
		expect(process.exitCode).toBe(1);
	});

	it("rejects invalid tractor engine preferences", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["set", "tractor.engine", "python"], {
			from: "user",
		});

		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid tractor.engine"));
		expect(process.exitCode).toBe(1);
	});

	it("rejects invalid runtime sidecar URLs", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command().parseAsync(["set", "runtime.sidecarUrl", "file:///tmp/socket"], {
			from: "user",
		});

		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid runtime.sidecarUrl"));
		expect(process.exitCode).toBe(1);
	});
});

// ── the record: a config change is remembered, with a working undo ────────────

describe("config set/unset are RECORDED — and never confirmed", () => {
	let cwd: string;
	let home: string;
	let tick: number;

	beforeEach(() => {
		cwd = makeTempDir();
		home = makeTempDir();
		tick = 0;
		process.exitCode = undefined;
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
		// Every scope here is a throwaway under /tmp; remove it so a suite that writes config
		// files and trails does not leave a trail of its own across the machine.
		fs.rmSync(cwd, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	/** A clock that advances, so two changes to the SAME key get distinct record ids. */
	const clock = () => `2026-07-30T12:00:0${tick++}.000Z`;

	function command() {
		return createConfigCommand(
			{ cwd: () => cwd, home: () => home },
			{ now: clock, decidedBy: "op", host: "torre" },
		);
	}

	const homeConfig = () => path.join(home, ".refarm", "config.json");
	const homeTrail = () => path.join(home, ".refarm", "operations.json");
	const localTrail = () => path.join(cwd, ".refarm", "operations.json");

	function readTrail(trailPath: string): {
		capability: string;
		version: number;
		records: Array<{
			id: string;
			requestId: string;
			kind: string;
			title: string;
			purpose: string;
			requester: string;
			decidedBy: string;
			decision: string;
			decidedAt: string;
			appliedAt: string | null;
			host?: string;
			changes: Array<{ path: string; before: string | null; after: string | null }>;
			undo: { kind: string; summary?: string; reason?: string };
			revisitOf?: string;
		}>;
	} {
		return JSON.parse(fs.readFileSync(trailPath, "utf-8"));
	}

	it("records a `set` with everything R3 asks for: what, why, who, when, and the undo", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});

		await command().parseAsync(
			["set", "runtime.autostart", "always", "--why", "quero o daemon subindo sozinho"],
			{ from: "user" },
		);

		const trail = readTrail(homeTrail());
		expect(trail.capability).toBe("operation-consent:v1");
		expect(trail.records).toHaveLength(1);
		const record = trail.records[0]!;
		expect(record.kind).toBe("config-set");
		expect(record.title).toBe("refarm config set runtime.autostart always");
		// WHY — the operator's own words, carried verbatim rather than re-worded.
		expect(record.purpose).toBe("quero o daemon subindo sozinho");
		// WHO asked, WHO authorised, WHEN, and on which machine.
		expect(record.requester).toBe("refarm config set");
		expect(record.decidedBy).toBe("op");
		expect(record.host).toBe("torre");
		expect(record.decision).toBe("authorized");
		expect(record.appliedAt).toBe(record.decidedAt);
		// WHAT CHANGED — complete snapshots, both sides.
		expect(record.changes).toHaveLength(1);
		expect(record.changes[0]?.path).toBe(homeConfig());
		expect(record.changes[0]?.before).toBeNull(); // the file did not exist yet
		expect(JSON.parse(String(record.changes[0]?.after))).toEqual({ autostart: "always" });
		// HOW TO UNDO IT.
		expect(record.undo.kind).toBe("restore-snapshot");
	});

	it("falls back to a factual purpose rather than inventing a motive", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		await command().parseAsync(["set", "tractor.engine", "rust"], { from: "user" });
		expect(readTrail(homeTrail()).records[0]?.purpose).toBe(
			'Operator set tractor.engine to "rust" in the home scope.',
		);
	});

	it("records an `unset` with the value that WAS there, so the undo can put it back", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		await command().parseAsync(["set", "runtime.autostart", "always"], { from: "user" });
		await command().parseAsync(["unset", "runtime.autostart"], { from: "user" });

		const records = readTrail(homeTrail()).records;
		expect(records.map((entry) => entry.kind)).toEqual(["config-set", "config-unset"]);
		const unset = records[1]!;
		expect(JSON.parse(String(unset.changes[0]?.before))).toEqual({ autostart: "always" });
		expect(JSON.parse(String(unset.changes[0]?.after))).toEqual({});
		// Same key, same scope ⇒ same requestId, so the two are ONE timeline.
		expect(unset.requestId).toBe(records[0]?.requestId);
		expect(unset.requestId).toBe("config:home:runtime.autostart");
	});

	it("NEVER asks the operator anything — no prompt, and no flag to suppress one", async () => {
		// The design decision, pinned. `config set` is the operator's own deliberate intent;
		// confirming what they just typed is the click-through training R4 exists to prevent.
		// Two guards: stdin is never touched, and there is no `--yes`/`--force`/`--confirm`.
		const stdinRead = vi.spyOn(process.stdin, "read");
		vi.spyOn(console, "log").mockImplementation(() => {});

		const configCommand = command();
		await configCommand.parseAsync(["set", "runtime.autostart", "always"], { from: "user" });
		expect(stdinRead).not.toHaveBeenCalled();

		const set = configCommand.commands.find((sub) => sub.name() === "set");
		const unset = configCommand.commands.find((sub) => sub.name() === "unset");
		for (const sub of [set, unset]) {
			const flags = (sub?.options ?? []).map((option) => option.long);
			expect(flags).not.toContain("--yes");
			expect(flags).not.toContain("--force");
			expect(flags).not.toContain("--confirm");
			expect(flags).not.toContain("--no-confirm");
		}
	});

	it("ROLLS BACK the config write when the record cannot be written", async () => {
		// "A change that cannot be remembered is not made" — the kit's PATH operation already
		// guarantees this, and `config set` inherits it by letting the block do the writing.
		vi.spyOn(console, "log").mockImplementation(() => {});
		await command().parseAsync(["set", "runtime.autostart", "always"], { from: "user" });
		const beforeSecond = fs.readFileSync(homeConfig(), "utf-8");

		const failing = createConfigCommand(
			{ cwd: () => cwd, home: () => home },
			{
				now: clock,
				trail: {
					async read() {
						return [];
					},
					async append(): Promise<never> {
						throw new Error("trail is read-only");
					},
				},
			},
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		// The rollback is unchanged; what changed is how the operator hears about it. This
		// used to escape `parseAsync` as a raw exception — a Node stack trace for a condition
		// the command handles perfectly well. It now refuses at the action boundary.
		await failing.parseAsync(["set", "tractor.engine", "rust"], { from: "user" });
		expect(process.exitCode).toBe(1);
		expect(errorSpy.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
			"trail is read-only",
		);
		// The file is exactly what it was — the second change was not made at all.
		expect(fs.readFileSync(homeConfig(), "utf-8")).toBe(beforeSecond);
	});

	it("`config history` lists what changed, when, why, and what would reverse it", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await command().parseAsync(["set", "runtime.autostart", "always", "--why", "porque sim"], {
			from: "user",
		});
		logSpy.mockClear();

		await command().parseAsync(["history"], { from: "user" });
		const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(printed).toContain(homeTrail());
		expect(printed).toContain("refarm config set runtime.autostart always");
		expect(printed).toContain("why:   porque sim");
		expect(printed).toContain("who:   op");
		expect(printed).toContain(homeConfig());
		// The clock ticks once for `requestedAt` and once for `decidedAt`; the id carries the
		// moment the change was DECIDED, which is the one an undo has to address.
		expect(printed).toContain(
			"refarm config history undo config:home:runtime.autostart#2026-07-30T12:00:01.000Z",
		);
	});

	it("`config history --json` is newest-first and hands off the undo", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await command().parseAsync(["set", "runtime.autostart", "always"], { from: "user" });
		await command().parseAsync(["set", "tractor.engine", "rust"], { from: "user" });
		logSpy.mockClear();

		await command().parseAsync(["history", "--json"], { from: "user" });
		const envelope = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			operation: string;
			trail: string;
			entries: Array<{ title: string; undoCommand: string | null }>;
			nextCommand: string;
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.operation).toBe("history");
		expect(envelope.trail).toBe(homeTrail());
		expect(envelope.entries.map((entry) => entry.title)).toEqual([
			"refarm config set tractor.engine rust",
			"refarm config set runtime.autostart always",
		]);
		expect(envelope.nextCommand).toBe(envelope.entries[0]?.undoCommand);
	});

	it("prints an empty history without inventing a file", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await command().parseAsync(["history"], { from: "user" });
		expect(logSpy.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
			"(nothing recorded yet)",
		);
		expect(fs.existsSync(homeTrail())).toBe(false);
	});

	it("the undo is EXECUTED, and the config file actually goes back", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		await command().parseAsync(["set", "runtime.autostart", "always"], { from: "user" });
		const afterFirst = fs.readFileSync(homeConfig(), "utf-8");
		await command().parseAsync(["set", "tractor.engine", "rust"], { from: "user" });
		expect(JSON.parse(fs.readFileSync(homeConfig(), "utf-8"))).toEqual({
			autostart: "always",
			tractor: { engine: "rust" },
		});

		const second = readTrail(homeTrail()).records[1]!;
		await command().parseAsync(["history", "undo", second.id], { from: "user" });

		// Not "the undo string was stored" — the FILE is back, byte for byte.
		expect(fs.readFileSync(homeConfig(), "utf-8")).toBe(afterFirst);
		expect(JSON.parse(fs.readFileSync(homeConfig(), "utf-8"))).toEqual({ autostart: "always" });
		// Append-only: the reversal is its own record, pointing at what it reversed.
		const records = readTrail(homeTrail()).records;
		expect(records.map((entry) => entry.decision)).toEqual(["authorized", "authorized", "undone"]);
		expect(records[2]?.revisitOf).toBe(second.id);
	});

	it("undoes a `set` that CREATED the config file by removing it again", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		await command().parseAsync(["set", "runtime.autostart", "always"], { from: "user" });
		expect(fs.existsSync(homeConfig())).toBe(true);

		const first = readTrail(homeTrail()).records[0]!;
		await command().parseAsync(["history", "undo", first.id], { from: "user" });
		expect(fs.existsSync(homeConfig())).toBe(false);
		// The trail itself survives — it lives beside the config, not inside it.
		expect(fs.existsSync(homeTrail())).toBe(true);
	});

	it("refuses an id that is not in the trail, naming how to find the ones that are", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		await command().parseAsync(["set", "runtime.autostart", "always"], { from: "user" });

		await command().parseAsync(["history", "undo", "config:home:nope#whenever"], {
			from: "user",
		});
		expect(String(errorSpy.mock.calls[0]?.[0])).toContain("refarm config history");
		expect(process.exitCode).toBe(1);
	});

	it("`--local` keeps its trail beside the project config, not in HOME", async () => {
		// A record whose file path points inside a checkout must not outlive the checkout.
		vi.spyOn(console, "log").mockImplementation(() => {});
		await command().parseAsync(["set", "tractor.engine", "rust", "--local"], { from: "user" });

		expect(fs.existsSync(localTrail())).toBe(true);
		expect(fs.existsSync(homeTrail())).toBe(false);
		const record = readTrail(localTrail()).records[0]!;
		expect(record.requestId).toBe("config:local:tractor.engine");
		expect(record.changes[0]?.path).toBe(path.join(cwd, ".refarm", "config.json"));
	});

	it("the home trail is the SAME file the cold-bootstrap kit writes its operations to", async () => {
		// `defaultTrailPath` in packages/farm-client is `join(home, ".refarm", "operations.json")`.
		// One place to read what has been configured on this machine, whichever tool did it.
		vi.spyOn(console, "log").mockImplementation(() => {});
		await command().parseAsync(["set", "runtime.autostart", "always"], { from: "user" });
		expect(homeTrail()).toBe(path.join(home, ".refarm", "operations.json"));
	});
});
