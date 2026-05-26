import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskDeps } from "../../src/commands/ask.js";
import { createAskCommand } from "../../src/commands/ask.js";
import type { LaunchDeps } from "../../src/commands/session-launch.js";

function makeChunk(
	content: string,
	sequence: number,
	is_final: boolean,
	metadata?: unknown,
): StreamChunk {
	return { stream_ref: "eff-1", content, sequence, is_final, metadata };
}

function makeDeps(overrides: Partial<AskDeps> = {}): AskDeps {
	return {
		submitEffort: vi.fn().mockResolvedValue("eff-1"),
		resolveSessionIdPrefix: vi
			.fn()
			.mockImplementation(async (prefix: string) => prefix),
		followStream: vi
			.fn()
			.mockImplementation(
				async (_effortId: string, onChunk: (chunk: StreamChunk) => void) => {
					onChunk(makeChunk("hello ", 0, false));
					onChunk(
						makeChunk("world", 1, true, {
							model: "claude-sonnet-4-6",
							tokens_in: 50,
							tokens_out: 100,
							estimated_usd: 0.0005,
						}),
					);
				},
			),
		readEffortResult: vi.fn().mockResolvedValue(null),
		readActiveSessionId: vi.fn().mockReturnValue(null),
		clearActiveSessionId: vi.fn().mockReturnValue(true),
		persistActiveSessionId: vi.fn(),
		collectSystemPrompt: vi.fn().mockResolvedValue("test system prompt"),
		...overrides,
	};
}

describe("refarm ask", () => {
	const originalProvider = process.env.MODEL_PROVIDER;
	const originalDefaultProvider = process.env.MODEL_DEFAULT_PROVIDER;
	const originalOpenAiKey = process.env.OPENAI_API_KEY;
	const originalHome = process.env.HOME;
	let tempHome: string | null = null;

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-ask-home-"));
		process.env.HOME = tempHome;
		delete process.env.MODEL_DEFAULT_PROVIDER;
		delete process.env.OPENAI_API_KEY;
	});

	afterEach(() => {
		if (originalProvider === undefined) {
			delete process.env.MODEL_PROVIDER;
		} else {
			process.env.MODEL_PROVIDER = originalProvider;
		}
		if (originalDefaultProvider === undefined) {
			delete process.env.MODEL_DEFAULT_PROVIDER;
		} else {
			process.env.MODEL_DEFAULT_PROVIDER = originalDefaultProvider;
		}
		if (originalOpenAiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiKey;
		}
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		if (tempHome) {
			fs.rmSync(tempHome, { recursive: true, force: true });
			tempHome = null;
		}
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("documents model route recovery in help", () => {
		const command = createAskCommand(makeDeps());
		let help = "";
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		command.outputHelp();

		expect(help).toContain("refarm model current");
		expect(help).toContain("refarm model providers");
		expect(help).toContain("refarm model openai/gpt-5.5");
	});

	it("submits effort with pi-agent respond payload", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["what is CRDT?"], { from: "user" });

		expect(deps.submitEffort).toHaveBeenCalledWith(
			expect.objectContaining({
				direction: "ask",
				source: "refarm-ask",
				tasks: [
					expect.objectContaining({
						pluginId: "@refarm/pi-agent",
						fn: "respond",
						args: expect.objectContaining({ prompt: "what is CRDT?" }),
					}),
				],
			}),
		);
		expect(deps.followStream).toHaveBeenCalledWith(
			"eff-1",
			expect.any(Function),
			expect.objectContaining({ submittedAtMs: expect.any(Number) }),
		);
		expect(outSpy).toHaveBeenCalled();

		logSpy.mockRestore();
		outSpy.mockRestore();
	}, 30_000);

	it("falls back to production active-session helpers when deps omit pointer hooks", async () => {
		const deps: AskDeps = {
			submitEffort: vi.fn().mockResolvedValue("eff-1"),
			followStream: vi
				.fn()
				.mockImplementation(
					async (_effortId: string, onChunk: (chunk: StreamChunk) => void) => {
						onChunk(makeChunk("ok", 0, true));
					},
			),
			collectSystemPrompt: vi.fn().mockResolvedValue("test system prompt"),
		};
		const command = createAskCommand(deps);
		const readSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue("urn:refarm:session:v1:active123");
		vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as string | undefined);
		const writeSpy = vi
			.spyOn(fs, "writeFileSync")
			.mockImplementation(() => undefined);
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["hello"], { from: "user" });

		expect(deps.submitEffort).toHaveBeenCalledWith(
			expect.objectContaining({
				tasks: [
					expect.objectContaining({
						args: expect.objectContaining({
							session_id: "urn:refarm:session:v1:active123",
						}),
					}),
				],
			}),
		);
		expect(writeSpy).toHaveBeenCalledWith(
			expect.stringContaining(".refarm/session.lock"),
			"urn:refarm:session:v1:active123",
			"utf-8",
		);
		expect(readSpy).toHaveBeenCalled();

		outSpy.mockRestore();
	});

	it("prints usage footer when final metadata is present", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["hello"], { from: "user" });

		const allLogs = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(allLogs).toContain("model:");
		expect(allLogs).toContain("claude-sonnet-4-6");
		expect(allLogs).toContain("50 in / 100 out");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("prints ask result as JSON without streaming text", async () => {
		const deps = makeDeps({
			readActiveSessionId: vi
				.fn()
				.mockReturnValue("urn:refarm:session:v1:jsonactive"),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["hello", "--json"], { from: "user" });

		expect(outSpy).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			effortId: "eff-1",
			sessionId: "urn:refarm:session:v1:jsonactive",
			content: "hello world",
			command: "ask",
			operation: "submit",
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand: null,
			nextCommands: [],
			metadata: {
				model: "claude-sonnet-4-6",
				tokens_in: 50,
				tokens_out: 100,
				estimated_usd: 0.0005,
			},
		});
		expect(deps.persistActiveSessionId).toHaveBeenCalledWith(
			"urn:refarm:session:v1:jsonactive",
		);

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("handles --files without failing", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["explain", "--files", "README.md,package.json"], {
			from: "user",
		});

		expect(deps.submitEffort).toHaveBeenCalledOnce();
		expect(deps.collectSystemPrompt).toHaveBeenCalledWith(
			expect.objectContaining({
				query: "explain",
				files: ["README.md", "package.json"],
			}),
		);
		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("starts runtime before submitting when launch deps are provided and the sidecar is down", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
		const deps = makeDeps();
		const launchDeps: LaunchDeps = {
			autostartMode: "always",
			operator: { ask: vi.fn() },
			spawnRuntime: vi.fn(),
			probeRuntimeUntilReady: vi.fn().mockResolvedValue(true),
		};
		const command = createAskCommand(deps, launchDeps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["hello"], { from: "user" });

		expect(launchDeps.spawnRuntime).toHaveBeenCalledOnce();
		expect(deps.submitEffort).toHaveBeenCalledOnce();

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("points missing provider failures at model current", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
		const deps = makeDeps();
		const launchDeps: LaunchDeps = {
			autostartMode: "always",
			operator: { ask: vi.fn() },
			spawnRuntime: vi.fn(),
			probeRuntimeUntilReady: vi.fn().mockResolvedValue(true),
		};
		const command = createAskCommand(deps, launchDeps);
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello"], { from: "user" });

		const output = errSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("No usable model credentials configured");
		expect(output).toContain("refarm model current");
		expect(output).toContain("refarm model providers");
		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		errSpy.mockRestore();
	});

	it("prints missing provider failures as JSON when requested", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
		const deps = makeDeps();
		const launchDeps: LaunchDeps = {
			autostartMode: "always",
			operator: { ask: vi.fn() },
			spawnRuntime: vi.fn(),
			probeRuntimeUntilReady: vi.fn().mockResolvedValue(true),
		};
		const command = createAskCommand(deps, launchDeps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello", "--json"], { from: "user" });

		expect(errSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			handoffs: {
				interactive: string;
				inspectCurrent: string;
				inspectProviders: string;
				localNoKeyModel: string;
				openExternalLinks: string;
			};
			nextAction: string;
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
			recommendations: { diagnostic: string; command: string }[];
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "model-credentials-missing",
			nextAction: "refarm sow",
			nextCommand: "refarm sow --model ollama/llama3.2 --json",
			handoffs: {
				interactive: "refarm sow",
				inspectCurrent: "refarm model current --json",
				inspectProviders: "refarm model providers --json",
				localNoKeyModel: "refarm sow --model ollama/llama3.2 --json",
				openExternalLinks: "refarm config get operator.openExternalLinks --json",
			},
		});
		expect(payload.nextActions).toContain(
			"refarm sow --model ollama/llama3.2 --json",
		);
		expect(payload.nextActions).toContain("refarm model current --json");
		expect(payload.nextCommands).not.toContain("refarm sow");
		expect(payload.nextCommands).toContain(
			"refarm sow --model ollama/llama3.2 --json",
		);
		expect(payload.nextCommands).toContain("refarm sow --json");
		expect(payload.nextCommands).toContain("refarm model providers --json");
		expect(payload.nextCommands).toContain("refarm model current --json");
		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("fails before submitting when runtime reports pi-agent missing", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			readPluginState: vi.fn().mockResolvedValue({
				installed: ["@refarm/pi-agent"],
				loaded: [],
				known: ["@refarm/pi-agent"],
			}),
		});
		const launchDeps: LaunchDeps = {
			autostartMode: "always",
			operator: { ask: vi.fn() },
			spawnRuntime: vi.fn(),
			probeRuntimeUntilReady: vi.fn().mockResolvedValue(true),
		};
		const command = createAskCommand(deps, launchDeps);
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello"], { from: "user" });

		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(errSpy).toHaveBeenCalledWith(
			expect.stringContaining("pi-agent is not loaded"),
		);
		expect(errSpy).toHaveBeenCalledWith(
			expect.stringContaining("Reload runtime plugins"),
		);
		expect(process.exitCode).toBe(1);

		errSpy.mockRestore();
	});

	it("prints pi-agent readiness failures as JSON when requested", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			readPluginState: vi.fn().mockResolvedValue({
				installed: ["@refarm/pi-agent"],
				loaded: [],
				known: ["@refarm/pi-agent"],
			}),
		});
		const launchDeps: LaunchDeps = {
			autostartMode: "always",
			operator: { ask: vi.fn() },
			spawnRuntime: vi.fn(),
			probeRuntimeUntilReady: vi.fn().mockResolvedValue(true),
		};
		const command = createAskCommand(deps, launchDeps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello", "--json"], { from: "user" });

		expect(errSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			nextAction: string;
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
			recommendations: { diagnostic: string; command: string }[];
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "pi-agent-not-loaded",
			nextAction: "refarm plugin reload @refarm/pi-agent --json",
			nextCommand: "refarm plugin reload @refarm/pi-agent --json",
		});
		expect(payload.nextActions).toContain("refarm plugin reload @refarm/pi-agent --json");
		expect(payload.nextActions).not.toContain("/reload @refarm/pi-agent");
		expect(payload.nextActions).toContain("refarm runtime start");
		expect(payload.nextCommands).toContain("refarm runtime ensure --wait --next-command");
		expect(payload.nextCommands).toContain("refarm runtime start --wait");
		expect(payload.nextCommands).toContain("refarm doctor --next-command");
		expect(payload.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "pi-agent-not-loaded",
				command: "refarm plugin reload @refarm/pi-agent --json",
			}),
		]);
		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("prints plugin install recovery as JSON when pi-agent is missing", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			readPluginState: vi.fn().mockResolvedValue({
				installed: [],
				loaded: [],
				known: [],
			}),
		});
		const launchDeps: LaunchDeps = {
			autostartMode: "always",
			operator: { ask: vi.fn() },
			spawnRuntime: vi.fn(),
			probeRuntimeUntilReady: vi.fn().mockResolvedValue(true),
		};
		const command = createAskCommand(deps, launchDeps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello", "--json"], { from: "user" });

		expect(errSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			nextAction: string;
			nextActions: string[];
			nextCommand: string;
			nextCommands: string[];
			recommendations: { diagnostic: string; command: string }[];
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "pi-agent-not-loaded",
			nextAction: "refarm plugin install",
			nextCommand: "refarm plugin install --json",
		});
		expect(payload.nextActions).toContain("refarm plugin install");
		expect(payload.nextActions).not.toContain("/reload @refarm/pi-agent");
		expect(payload.nextCommands).toContain("refarm plugin install --json");
		expect(payload.nextCommands).not.toContain("refarm plugin install");
		expect(payload.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "pi-agent-not-loaded",
				command: "refarm plugin install --json",
			}),
		]);
		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("prints model provider failures with executable recovery commands as JSON", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			submitEffort: vi
				.fn()
				.mockRejectedValue(
					new Error('model-bridge request failed for provider "openai"'),
				),
		});
		const launchDeps: LaunchDeps = {
			autostartMode: "always",
			operator: { ask: vi.fn() },
			spawnRuntime: vi.fn(),
			probeRuntimeUntilReady: vi.fn().mockResolvedValue(true),
		};
		const command = createAskCommand(deps, launchDeps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello", "--json"], { from: "user" });

		expect(errSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			ok: false,
			error: "model-provider-unavailable",
			provider: "openai",
			nextAction: "refarm sow",
			nextCommand: "refarm model current --json",
			nextCommands: [
				"refarm model current --json",
				"refarm model providers --json",
				"refarm model openai/gpt-5.5 --json",
			],
		});
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("prints runtime submit failures with executable recovery commands as JSON", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			submitEffort: vi.fn().mockRejectedValue(new Error("fetch failed")),
		});
		const launchDeps: LaunchDeps = {
			autostartMode: "always",
			operator: { ask: vi.fn() },
			spawnRuntime: vi.fn(),
			probeRuntimeUntilReady: vi.fn().mockResolvedValue(true),
		};
		const command = createAskCommand(deps, launchDeps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello", "--json"], { from: "user" });

		expect(errSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			ok: false,
			error: "runtime-unavailable",
			nextAction: "refarm runtime ensure --wait --next-command",
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: [
				"refarm runtime ensure --wait --next-command",
				"refarm runtime start --wait",
				"refarm doctor --next-command",
			],
			recommendations: [
				expect.objectContaining({
					diagnostic: "runtime:unavailable",
					command: "refarm runtime ensure --wait --next-command",
				}),
			],
		});
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("reloads installed pi-agent before submitting when it is not loaded", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			readPluginState: vi
				.fn()
				.mockResolvedValueOnce({
					installed: ["@refarm/pi-agent"],
					loaded: [],
					known: ["@refarm/pi-agent"],
				})
				.mockResolvedValueOnce({
					installed: ["@refarm/pi-agent"],
					loaded: ["@refarm/pi-agent"],
					known: ["@refarm/pi-agent"],
				}),
			reloadPlugins: vi.fn().mockResolvedValue({
				reloaded: ["@refarm/pi-agent"],
				deferred: [],
				skipped: [],
			}),
		});
		const launchDeps: LaunchDeps = {
			autostartMode: "always",
			operator: { ask: vi.fn() },
			spawnRuntime: vi.fn(),
			probeRuntimeUntilReady: vi.fn().mockResolvedValue(true),
		};
		const command = createAskCommand(deps, launchDeps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["hello"], { from: "user" });

		expect(deps.reloadPlugins).toHaveBeenCalledWith(["@refarm/pi-agent"]);
		expect(deps.submitEffort).toHaveBeenCalledOnce();

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("reports skipped pi-agent auto-reloads as JSON failures", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			readPluginState: vi.fn().mockResolvedValue({
				installed: ["@refarm/pi-agent"],
				loaded: [],
				known: ["@refarm/pi-agent"],
			}),
			reloadPlugins: vi.fn().mockResolvedValue({
				reloaded: [],
				deferred: [],
				skipped: ["@refarm/pi-agent"],
			}),
		});
		const launchDeps: LaunchDeps = {
			autostartMode: "always",
			operator: { ask: vi.fn() },
			spawnRuntime: vi.fn(),
			probeRuntimeUntilReady: vi.fn().mockResolvedValue(true),
		};
		const command = createAskCommand(deps, launchDeps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello", "--json"], { from: "user" });

		expect(errSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			ok: false,
			command: "ask",
			operation: "plugin-readiness",
			error: "pi-agent-reload-failed",
			message: "pi-agent reload was requested but the runtime skipped it.",
			installed: true,
			known: true,
			reloaded: [],
			deferred: [],
			skipped: ["@refarm/pi-agent"],
			nextAction: "refarm plugin reload @refarm/pi-agent --json",
			nextCommand: "refarm plugin reload @refarm/pi-agent --json",
			nextCommands: [
				"refarm plugin reload @refarm/pi-agent --json",
				"refarm runtime ensure --wait --next-command",
				"refarm doctor --next-command",
			],
			recommendations: [
				expect.objectContaining({
					diagnostic: "pi-agent-reload-failed",
					command: "refarm plugin reload @refarm/pi-agent --json",
				}),
			],
		});
		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("starts a fresh session for --new even when an old active pointer exists", async () => {
		const deps = makeDeps({
			readActiveSessionId: vi
				.fn()
				.mockReturnValue("urn:refarm:session:v1:oldactive"),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["fresh please", "--new"], { from: "user" });

		expect(deps.clearActiveSessionId).toHaveBeenCalledOnce();
		expect(deps.submitEffort).toHaveBeenCalledWith(
			expect.objectContaining({
				tasks: [
					expect.objectContaining({
						args: expect.objectContaining({
							session_id: expect.stringMatching(/^urn:refarm:session:v1:/),
						}),
					}),
				],
			}),
		);
		expect(deps.submitEffort).not.toHaveBeenCalledWith(
			expect.objectContaining({
				tasks: [
					expect.objectContaining({
						args: expect.objectContaining({
							session_id: "urn:refarm:session:v1:oldactive",
						}),
					}),
				],
			}),
		);
		const effort = vi.mocked(deps.submitEffort).mock.calls[0]![0] as {
			tasks: Array<{ args: { session_id: string } }>;
		};
		const submittedSessionId = effort.tasks[0]!.args.session_id;
		expect(deps.persistActiveSessionId).toHaveBeenCalledWith(
			submittedSessionId,
		);
		expect(submittedSessionId).not.toBe("urn:refarm:session:v1:oldactive");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("falls back to effort result file payload when stream times out", async () => {
		const deps = makeDeps({
			readActiveSessionId: vi
				.fn()
				.mockReturnValue("urn:refarm:session:v1:activefallback"),
			followStream: vi.fn().mockRejectedValue(new Error("stream timeout")),
			readEffortResult: vi.fn().mockResolvedValue({
				status: "ok",
				content: "fallback response",
				metadata: { model: "mock-model", tokens_in: 1, tokens_out: 2 },
			}),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["fallback please"], { from: "user" });

		expect(deps.followStream).toHaveBeenCalledOnce();
		expect(deps.readEffortResult).toHaveBeenCalledWith("eff-1");
		expect(deps.persistActiveSessionId).toHaveBeenCalledWith(
			"urn:refarm:session:v1:activefallback",
		);
		expect(outSpy).toHaveBeenCalledWith("fallback response\n");

		const allLogs = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(allLogs).toContain("model:");
		expect(allLogs).toContain("mock-model");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("prints fallback ask result as JSON when stream times out", async () => {
		const deps = makeDeps({
			readActiveSessionId: vi
				.fn()
				.mockReturnValue("urn:refarm:session:v1:jsonfallback"),
			followStream: vi.fn().mockRejectedValue(new Error("stream timeout")),
			readEffortResult: vi.fn().mockResolvedValue({
				status: "ok",
				content: "fallback response",
				metadata: { model: "mock-model", tokens_in: 1, tokens_out: 2 },
			}),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["fallback please", "--json"], { from: "user" });

		expect(outSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			effortId: "eff-1",
			sessionId: "urn:refarm:session:v1:jsonfallback",
			content: "fallback response",
			command: "ask",
			operation: "submit",
			ok: true,
			nextAction: null,
			nextActions: [],
			nextCommand: null,
			nextCommands: [],
			metadata: { model: "mock-model", tokens_in: 1, tokens_out: 2 },
		});

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("uses explicit --session value in effort payload", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(
			["hello", "--session", "urn:refarm:session:v1:test123"],
			{
				from: "user",
			},
		);

		expect(deps.submitEffort).toHaveBeenCalledWith(
			expect.objectContaining({
				tasks: [
					expect.objectContaining({
						args: expect.objectContaining({
							session_id: "urn:refarm:session:v1:test123",
						}),
					}),
				],
			}),
		);

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("resolves --session prefix before submitting effort", async () => {
		const deps = makeDeps({
			resolveSessionIdPrefix: vi
				.fn()
				.mockResolvedValue("urn:refarm:session:v1:resolved123"),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["hello", "--session", "resolved123"], {
			from: "user",
		});

		expect(deps.resolveSessionIdPrefix).toHaveBeenCalledWith("resolved123");
		expect(deps.submitEffort).toHaveBeenCalledWith(
			expect.objectContaining({
				tasks: [
					expect.objectContaining({
						args: expect.objectContaining({
							session_id: "urn:refarm:session:v1:resolved123",
						}),
					}),
				],
			}),
		);

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("fails closed when active pointer verification rejects session persistence", async () => {
		const deps = makeDeps({
			persistActiveSessionId: vi.fn().mockImplementation(() => {
				throw new Error(
					'Session switch expected active session "urn:refarm:session:v1:target", got "urn:refarm:session:v1:other".',
				);
			}),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(
			["hello", "--session", "urn:refarm:session:v1:target"],
			{
				from: "user",
			},
		);

		expect(deps.submitEffort).toHaveBeenCalledOnce();
		expect(deps.persistActiveSessionId).toHaveBeenCalledWith(
			"urn:refarm:session:v1:target",
		);
		expect(errSpy).toHaveBeenCalledWith(
			expect.stringContaining("Session switch expected active session"),
		);
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		outSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("fails when --session prefix is ambiguous", async () => {
		const deps = makeDeps({
			resolveSessionIdPrefix: vi
				.fn()
				.mockRejectedValue(
					new Error('Ambiguous session prefix "abc" (2 matches)'),
				),
		});
		const command = createAskCommand(deps);
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello", "--session", "abc"], {
			from: "user",
		});

		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(errSpy).toHaveBeenCalledWith(
			expect.stringContaining('Ambiguous session prefix "abc"'),
		);
		expect(process.exitCode).toBe(1);

		errSpy.mockRestore();
	});

	it("prints session prefix failures as JSON with executable recovery command", async () => {
		const deps = makeDeps({
			resolveSessionIdPrefix: vi
				.fn()
				.mockRejectedValue(
					new Error('Ambiguous session prefix "abc" (2 matches)'),
				),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello", "--session", "abc", "--json"], {
			from: "user",
		});

		expect(errSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			ok: false,
			error: "ambiguous-session-prefix",
			nextAction: "refarm sessions list --json",
			nextCommand: "refarm sessions list --json",
			nextCommands: ["refarm sessions list --json"],
		});
		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("rejects --new together with --session", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(
			["hello", "--new", "--session", "urn:refarm:session:v1:test123"],
			{
				from: "user",
			},
		);

		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(errSpy).toHaveBeenCalledWith(
			expect.stringContaining("--new and --session cannot be used together"),
		);
		expect(process.exitCode).toBe(1);

		errSpy.mockRestore();
	});

	it("rejects incompatible session flags as JSON", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(
			["hello", "--new", "--session", "urn:refarm:session:v1:test123", "--json"],
			{
				from: "user",
			},
		);

		expect(errSpy).not.toHaveBeenCalled();
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			ok: boolean;
			error: string;
			nextAction: string;
			nextCommand: string;
		};
		expect(payload).toMatchObject({
			ok: false,
			error: "invalid-options",
			nextAction: "refarm ask 'hello' --new --json",
			nextCommand: "refarm ask 'hello' --new --json",
		});
		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});
});
