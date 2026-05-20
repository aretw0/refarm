import fs from "node:fs";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
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
		...overrides,
	};
}

describe("refarm ask", () => {
	const originalProvider = process.env.MODEL_PROVIDER;

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		if (originalProvider === undefined) {
			delete process.env.MODEL_PROVIDER;
		} else {
			process.env.MODEL_PROVIDER = originalProvider;
		}
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
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
	});

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
		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("starts Farmhand before submitting when launch deps are provided and the sidecar is down", async () => {
		process.env.MODEL_PROVIDER = "openai";
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
		const deps = makeDeps();
		const launchDeps: LaunchDeps = {
			autostartMode: "always",
			operator: { ask: vi.fn() },
			spawnFarmhand: vi.fn(),
			probeFarmhandUntilReady: vi.fn().mockResolvedValue(true),
		};
		const command = createAskCommand(deps, launchDeps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["hello"], { from: "user" });

		expect(launchDeps.spawnFarmhand).toHaveBeenCalledOnce();
		expect(deps.submitEffort).toHaveBeenCalledOnce();

		logSpy.mockRestore();
		outSpy.mockRestore();
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
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		await expect(
			command.parseAsync(
				["hello", "--session", "urn:refarm:session:v1:target"],
				{
					from: "user",
				},
			),
		).rejects.toThrow("exit:1");

		expect(deps.submitEffort).toHaveBeenCalledOnce();
		expect(deps.persistActiveSessionId).toHaveBeenCalledWith(
			"urn:refarm:session:v1:target",
		);
		expect(errSpy).toHaveBeenCalledWith(
			expect.stringContaining("Session switch expected active session"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);

		logSpy.mockRestore();
		outSpy.mockRestore();
		errSpy.mockRestore();
		exitSpy.mockRestore();
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
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		await expect(
			command.parseAsync(["hello", "--session", "abc"], {
				from: "user",
			}),
		).rejects.toThrow("exit:1");

		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(errSpy).toHaveBeenCalledWith(
			expect.stringContaining('Ambiguous session prefix "abc"'),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);

		errSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("rejects --new together with --session", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: string | number | null | undefined,
		) => {
			throw new Error(`exit:${code ?? 0}`);
		}) as never);

		await expect(
			command.parseAsync(
				["hello", "--new", "--session", "urn:refarm:session:v1:test123"],
				{
					from: "user",
				},
			),
		).rejects.toThrow("exit:1");

		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(errSpy).toHaveBeenCalledWith(
			expect.stringContaining("--new and --session cannot be used together"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);

		errSpy.mockRestore();
		exitSpy.mockRestore();
	});
});
