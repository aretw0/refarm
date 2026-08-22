import { RUNTIME_AGENT_PLUGIN_ID } from "@refarm.dev/config";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskDeps } from "../../src/commands/ask.js";
import {
	createAskCommand,
	loadSessionsSnapshot,
	onceAsync,
	resetSessionsSnapshotForTests,
	resolveRuntimeStreamsDir,
	resolveRuntimeTaskResultsDir,
} from "../../src/commands/ask.js";
import type { LaunchDeps } from "../../src/commands/session-launch.js";
import { SESSION_LOCK_PATH } from "../../src/commands/session-lock.js";

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
		resolveSessionIdPrefix: vi.fn().mockImplementation(async (prefix: string) => prefix),
		followStream: vi
			.fn()
			.mockImplementation(async (_effortId: string, onChunk: (chunk: StreamChunk) => void) => {
				onChunk(makeChunk("hello ", 0, false));
				onChunk(
					makeChunk("world", 1, true, {
						model: "claude-sonnet-4-6",
						tokens_in: 50,
						tokens_out: 100,
						estimated_usd: 0.0005,
					}),
				);
			}),
		readEffortResult: vi.fn().mockResolvedValue(null),
		readActiveSessionId: vi.fn().mockReturnValue(null),
		clearActiveSessionId: vi.fn().mockReturnValue(true),
		persistActiveSessionId: vi.fn(),
		collectSystemPrompt: vi.fn().mockResolvedValue("test system prompt"),
		// Fix round 1: these two used to run for real in every test that reached
		// this point — reading the operator's actual .refarm/config.json and
		// making a live network call to the sidecar. Stubbed here so the suite
		// touches neither; tests that care about workspace attribution override
		// them explicitly.
		declaredWorkspaceRoots: vi.fn().mockReturnValue([]),
		readSessionWorkspace: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

describe("refarm ask", () => {
	const originalProvider = process.env.MODEL_PROVIDER;
	const originalDefaultProvider = process.env.MODEL_DEFAULT_PROVIDER;
	const originalModelId = process.env.MODEL_ID;
	const originalBaseUrl = process.env.MODEL_BASE_URL;
	const originalOpenAiKey = process.env.OPENAI_API_KEY;
	const originalOpenAiCodexToken = process.env.OPENAI_CODEX_ACCESS_TOKEN;
	const originalGithubCopilotToken = process.env.GITHUB_COPILOT_ACCESS_TOKEN;
	const originalRefarmHome = process.env.REFARM_HOME;
	const originalHome = process.env.HOME;
	const originalStreamsDir = process.env.REFARM_STREAMS_DIR;
	const originalTaskResultsDir = process.env.REFARM_TASK_RESULTS_DIR;
	let tempHome: string | null = null;

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-ask-home-"));
		process.env.HOME = tempHome;
		delete process.env.MODEL_ID;
		delete process.env.MODEL_DEFAULT_PROVIDER;
		delete process.env.OPENAI_API_KEY;
		delete process.env.OPENAI_CODEX_ACCESS_TOKEN;
		delete process.env.GITHUB_COPILOT_ACCESS_TOKEN;
		delete process.env.REFARM_HOME;
		delete process.env.REFARM_STREAMS_DIR;
		delete process.env.REFARM_TASK_RESULTS_DIR;
		delete process.env.MODEL_PROFILE;
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
		if (originalModelId === undefined) {
			delete process.env.MODEL_ID;
		} else {
			process.env.MODEL_ID = originalModelId;
		}
		if (originalBaseUrl === undefined) {
			delete process.env.MODEL_BASE_URL;
		} else {
			process.env.MODEL_BASE_URL = originalBaseUrl;
		}
		if (originalOpenAiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = originalOpenAiKey;
		}
		if (originalOpenAiCodexToken === undefined) {
			delete process.env.OPENAI_CODEX_ACCESS_TOKEN;
		} else {
			process.env.OPENAI_CODEX_ACCESS_TOKEN = originalOpenAiCodexToken;
		}
		if (originalGithubCopilotToken === undefined) {
			delete process.env.GITHUB_COPILOT_ACCESS_TOKEN;
		} else {
			process.env.GITHUB_COPILOT_ACCESS_TOKEN = originalGithubCopilotToken;
		}
		if (originalRefarmHome === undefined) {
			delete process.env.REFARM_HOME;
		} else {
			process.env.REFARM_HOME = originalRefarmHome;
		}
		if (originalStreamsDir === undefined) {
			delete process.env.REFARM_STREAMS_DIR;
		} else {
			process.env.REFARM_STREAMS_DIR = originalStreamsDir;
		}
		if (originalTaskResultsDir === undefined) {
			delete process.env.REFARM_TASK_RESULTS_DIR;
		} else {
			process.env.REFARM_TASK_RESULTS_DIR = originalTaskResultsDir;
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
		expect(help).toContain('refarm ask "hello" --scope worker');
		expect(help).toContain("refarm model openai/gpt-5.6-sol");
	});

	it("resolves runtime stream and result directories from env overrides", () => {
		expect(resolveRuntimeStreamsDir({ REFARM_STREAMS_DIR: "/tmp/refarm-streams" })).toBe(
			"/tmp/refarm-streams",
		);
		expect(
			resolveRuntimeTaskResultsDir({
				REFARM_TASK_RESULTS_DIR: "/tmp/refarm-results",
			}),
		).toBe("/tmp/refarm-results");
	});

	/** A node holding two seats of one provider, with `workspaceId` declaring them in order. */
	function declareTwoSeats(order: string[]): void {
		// Narrowed rather than coerced: `path.join(null ?? "", ".refarm")` is a RELATIVE path, so a
		// helper called outside `beforeEach` would quietly declare seats into the repository.
		if (!tempHome) throw new Error("declareTwoSeats needs the temporary HOME from beforeEach.");
		const home = path.join(tempHome, ".refarm");
		fs.mkdirSync(home, { recursive: true });
		fs.writeFileSync(
			path.join(home, "model-accounts.json"),
			JSON.stringify(
				["first", "second"].map((alias, index) => ({
					credentialId: `model-account:${alias.toUpperCase().padEnd(26, "X")}`,
					provider: "github-copilot",
					alias,
					identity: { status: "unverified" },
					secretRef: `model/${alias}`,
					health: "healthy",
					revision: `sha256:r${index}`,
				})),
			),
		);
		fs.writeFileSync(
			path.join(home, "config.json"),
			JSON.stringify({ modelBindings: { paid: order } }),
		);
		process.env.REFARM_HOME = home;
		process.env.MODEL_PROVIDER = "github-copilot";
	}

	/** The declared-workspace roots `--workspace paid` needs to be accepted at all. */
	const PAID_ROOTS = [{ id: "paid", absolutePath: "/home/op/paid" }];

	const SEAT_ONE = `model-account:${"FIRST".padEnd(26, "X")}`;
	const SEAT_TWO = `model-account:${"SECOND".padEnd(26, "X")}`;

	it("falls to the next DECLARED seat when the first is refused for quota", async () => {
		// ISS-157, the reactive half. The order is the operator's standing instruction; a provider
		// refusing the first seat is a fact, and honouring what he already declared needs no
		// prediction about which meter a model consumes.
		declareTwoSeats([SEAT_ONE, SEAT_TWO]);
		const deps = makeDeps({
			declaredWorkspaceRoots: vi.fn().mockReturnValue(PAID_ROOTS),
			followStream: vi
				.fn()
				.mockRejectedValueOnce(new Error("model quota exceeded for this account"))
				.mockImplementation(async (_id: string, onChunk: (chunk: StreamChunk) => void) => {
					onChunk(makeChunk("ok", 0, true, { model: "gpt-4o" }));
				}),
		});
		const command = createAskCommand(deps);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello", "--workspace", "paid"], { from: "user" });

		const spent = (deps.submitEffort as ReturnType<typeof vi.fn>).mock.calls.map(
			([effort]) => (effort as { credentialId?: string }).credentialId,
		);
		expect(spent).toEqual([SEAT_ONE, SEAT_TWO]);
		expect(process.exitCode).not.toBe(1);
	});

	it("stops at the end of the declared order rather than spending an unnamed seat", async () => {
		// The property that makes the walk safe: `second` is healthy and sitting right there, and
		// it was never declared for this workspace.
		declareTwoSeats([SEAT_ONE]);
		const deps = makeDeps({
			declaredWorkspaceRoots: vi.fn().mockReturnValue(PAID_ROOTS),
			followStream: vi.fn().mockRejectedValue(new Error("model quota exceeded for this account")),
		});
		const command = createAskCommand(deps);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello", "--workspace", "paid"], { from: "user" });

		const spent = (deps.submitEffort as ReturnType<typeof vi.fn>).mock.calls.map(
			([effort]) => (effort as { credentialId?: string }).credentialId,
		);
		expect(spent).toEqual([SEAT_ONE]);
		expect(process.exitCode).toBe(1);
	});

	it("does not walk after an answer has already been printed", async () => {
		// A stream that emitted text and THEN failed cannot be retried: the operator would read one
		// answer twice, spliced. Failing toward the previous behaviour is the only honest move.
		declareTwoSeats([SEAT_ONE, SEAT_TWO]);
		const deps = makeDeps({
			declaredWorkspaceRoots: vi.fn().mockReturnValue(PAID_ROOTS),
			followStream: vi
				.fn()
				.mockImplementationOnce(async (_id: string, onChunk: (chunk: StreamChunk) => void) => {
					onChunk(makeChunk("half an answer", 0, false));
					throw new Error("model quota exceeded for this account");
				}),
		});
		const command = createAskCommand(deps);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello", "--workspace", "paid"], { from: "user" });

		expect((deps.submitEffort as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
		expect(process.exitCode).toBe(1);
	});

	it("does not walk on a failure that is not about quota", async () => {
		// Walking on any error would spend a second seat on a bug, twice.
		declareTwoSeats([SEAT_ONE, SEAT_TWO]);
		const deps = makeDeps({
			declaredWorkspaceRoots: vi.fn().mockReturnValue(PAID_ROOTS),
			followStream: vi.fn().mockRejectedValue(new Error("runtime agent is not loaded")),
		});
		const command = createAskCommand(deps);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello", "--workspace", "paid"], { from: "user" });

		expect((deps.submitEffort as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
	});

	it("submits effort with runtime agent respond payload", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["what is CRDT?"], { from: "user" });

		expect(deps.submitEffort).toHaveBeenCalledWith(
			expect.objectContaining({
				direction: "ask",
				source: "refarm-ask",
				tasks: [
					expect.objectContaining({
						pluginId: "@refarm/agent",
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

	it("submits ask worker scope as an explicit worker-routed ask source", async () => {
		process.env.MODEL_PROVIDER = "openai-codex";
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello", "--scope", "worker"], { from: "user" });

		expect(deps.submitEffort).toHaveBeenCalledWith(
			expect.objectContaining({
				source: "refarm-ask:worker",
				tasks: [
					expect.objectContaining({
						args: expect.objectContaining({
							prompt: "hello",
							provider: "openai-codex",
							model: "gpt-5.3-codex-spark",
						}),
					}),
				],
			}),
		);
		const allLogs = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(allLogs).toContain("runtime agent (worker)");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("routes by --profile: sends args.profile and omits the pinned route (ADR-012)", async () => {
		process.env.MODEL_PROVIDER = "openai-codex";
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["cheap question", "--profile", "cheap"], { from: "user" });

		const effort = (deps.submitEffort as ReturnType<typeof vi.fn>).mock.calls[0]![0];
		const args = effort.tasks[0].args as Record<string, unknown>;
		expect(args.profile).toBe("cheap");
		// The profile REPLACES the pinned route so the guest resolver isn't shadowed.
		expect(args.provider).toBeUndefined();
		expect(args.model).toBeUndefined();

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("honors an ambient MODEL_PROFILE when no --profile flag is given (ADR-012)", async () => {
		process.env.MODEL_PROVIDER = "openai-codex";
		process.env.MODEL_PROFILE = "reliable";
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["q"], { from: "user" });

		const effort = (deps.submitEffort as ReturnType<typeof vi.fn>).mock.calls[0]![0];
		const args = effort.tasks[0].args as Record<string, unknown>;
		expect(args.profile).toBe("reliable");
		expect(args.provider).toBeUndefined();

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("--expect declares what the answer must contain, and it rides the effort", async () => {
		process.env.MODEL_PROVIDER = "openai-codex";
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["how many .md files?", "--expect", "59"], {
			from: "user",
		});

		const effort = (deps.submitEffort as ReturnType<typeof vi.fn>).mock.calls[0]![0];
		// The wire field the sidecar reads (`Effort.expectation`) — the record can
		// only say a run was WRONG if the declaration reaches it.
		expect(effort.expectation).toBe("59");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("no --expect flag ⇒ the submitted effort carries no expectation key at all", async () => {
		// Nobody checked is the ordinary case and must stay the default: no key,
		// not a null, so the observation records no verdict rather than one that
		// reads as "checked and inconclusive".
		process.env.MODEL_PROVIDER = "openai-codex";
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["how many .md files?"], { from: "user" });

		const effort = (deps.submitEffort as ReturnType<typeof vi.fn>).mock.calls[0]![0];
		expect("expectation" in effort).toBe(false);
		expect(JSON.stringify(effort).includes("expectation")).toBe(false);

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("--workspace declares which workspace this run belongs to, and it rides the effort", async () => {
		process.env.MODEL_PROVIDER = "openai-codex";
		const deps = makeDeps({
			declaredWorkspaceRoots: vi.fn().mockReturnValue([
				{ id: "rcdc5", absolutePath: "/home/op/git/rcdc5" },
				{ id: "refarm", absolutePath: "/home/op/github/refarm" },
			]),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello", "--workspace", "rcdc5"], { from: "user" });

		const effort = (deps.submitEffort as ReturnType<typeof vi.fn>).mock.calls[0]![0];
		const args = effort.tasks[0].args as Record<string, unknown>;
		// The wire fields: `Effort.workspaceId` (root, for the sidecar's BudgetObservation)
		// and `args.workspace_id` (for the agent, which stamps it on the Session node).
		expect(effort.workspaceId).toBe("rcdc5");
		expect(args.workspace_id).toBe("rcdc5");
		expect(args.workspace_source).toBe("declared");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("rejects an undeclared --workspace, naming the declared ones, and never dispatches", async () => {
		const deps = makeDeps({
			declaredWorkspaceRoots: vi.fn().mockReturnValue([
				{ id: "rcdc5", absolutePath: "/home/op/git/rcdc5" },
				{ id: "refarm", absolutePath: "/home/op/github/refarm" },
			]),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["hello", "--workspace", "rcdc", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(payload).toMatchObject({
			ok: false,
			command: "ask",
			operation: "options",
			error: "invalid-workspace",
		});
		expect(payload.message).toContain("rcdc5");
		expect(payload.message).toContain("refarm");
		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
	});

	it("a /sessions body that parses but carries no `sessions` array reads as unknown, not absent — no cwd seed fires", async () => {
		const deps = makeDeps({
			// Exercise the REAL readSessionWorkspace (not the suite-wide stub) so the
			// sidecar response shape actually reaches the tri-state collapse under test.
			readSessionWorkspace: undefined,
			// A declared root that matches cwd exactly: if the fix regressed and this
			// read fell through to "absent" (undefined) instead of "unknown", the ladder
			// would wrongly seed workspaceId from cwd right here.
			declaredWorkspaceRoots: vi
				.fn()
				.mockReturnValue([{ id: "here", absolutePath: process.cwd() }]),
		});
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello"], { from: "user" });

		const effort = (deps.submitEffort as ReturnType<typeof vi.fn>).mock.calls[0]![0];
		const args = effort.tasks[0].args as Record<string, unknown> | null | undefined;
		expect("workspaceId" in effort).toBe(false);
		expect(args != null ? "workspace_id" in args : false).toBe(false);
		expect(args != null ? "workspace_source" in args : false).toBe(false);

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("rejects invalid ask model scopes as JSON", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["hello", "--scope", "fast", "--json"], {
			from: "user",
		});

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(payload).toMatchObject({
			ok: false,
			command: "ask",
			operation: "options",
			error: "invalid-model-scope",
			nextAction: "refarm ask 'hello' --scope worker --json",
			nextCommand: "refarm ask 'hello' --scope worker --json",
			allowedScopes: ["default", "worker", "monitor"],
		});
		expect(payload.nextCommands).toContain("refarm model current --json");
		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
	});

	it("falls back to production active-session helpers when deps omit pointer hooks", async () => {
		const deps: AskDeps = {
			submitEffort: vi.fn().mockResolvedValue("eff-1"),
			followStream: vi
				.fn()
				.mockImplementation(async (_effortId: string, onChunk: (chunk: StreamChunk) => void) => {
					onChunk(makeChunk("ok", 0, true));
				}),
			collectSystemPrompt: vi.fn().mockResolvedValue("test system prompt"),
			// Not the fallback under test here — stubbed so this test doesn't read
			// the real config or hit the real sidecar over the network either.
			declaredWorkspaceRoots: vi.fn().mockReturnValue([]),
			readSessionWorkspace: vi.fn().mockResolvedValue(undefined),
		};
		const command = createAskCommand(deps);
		const readSpy = vi
			.spyOn(fs, "readFileSync")
			.mockReturnValue("urn:sovereign:session:v1:active123");
		vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as string | undefined);
		// getWriteCandidatePaths() probes writability with a real (unmocked) accessSync
		// on the lock dir's parent. That parent only pre-exists by accident on a real
		// operator machine (the actual ~/.refarm) — under the suite-wide throwaway HOME
		// (see vitest.setup.ts) the sandboxed dir is genuinely empty, so this must be
		// stubbed too, or the write path resolves to "none available" instead of the
		// production fallback this test exercises.
		vi.spyOn(fs, "accessSync").mockImplementation(() => undefined);
		const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello"], { from: "user" });

		expect(deps.submitEffort).toHaveBeenCalledWith(
			expect.objectContaining({
				tasks: [
					expect.objectContaining({
						args: expect.objectContaining({
							session_id: "urn:sovereign:session:v1:active123",
						}),
					}),
				],
			}),
		);
		expect(writeSpy).toHaveBeenCalledWith(
			SESSION_LOCK_PATH,
			"urn:sovereign:session:v1:active123",
			"utf-8",
		);
		expect(readSpy).toHaveBeenCalled();

		outSpy.mockRestore();
	});

	it("prints usage footer when final metadata is present", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello"], { from: "user" });

		const allLogs = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(allLogs).toContain("model:");
		expect(allLogs).toContain("claude-sonnet-4-6");
		expect(allLogs).toContain("50 in / 100 out");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("replaces the stream's zero placeholders with usage from the terminal effort", async () => {
		const deps = makeDeps({
			followStream: vi
				.fn()
				.mockImplementation(async (_effortId: string, onChunk: (chunk: StreamChunk) => void) => {
					onChunk(
						makeChunk("measured answer", 0, true, {
							model: "gpt-5.5",
							tokens_in: 0,
							tokens_out: 0,
						}),
					);
				}),
			readEffortResult: vi.fn().mockResolvedValue({
				status: "ok",
				content: "measured answer",
				metadata: {
					model: "gpt-5.5",
					tokens_in: 1400,
					tokens_out: 12,
					pricing_mode: "subscription",
				},
			}),
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await createAskCommand(deps).parseAsync(["measure this"], { from: "user" });

		const allLogs = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(allLogs).toContain("1400 in / 12 out");
		expect(allLogs).toContain("subscription");
		expect(allLogs).not.toContain("0 in / 0 out");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("reconstructs the whole answer from deltas with an empty final marker", async () => {
		// The guest's streaming contract: partial lines carry the deltas, and the
		// FINAL line is an empty end-marker (content:"") so `content += chunk.content`
		// reconstructs the whole answer exactly once — no doubling.
		const deps = makeDeps({
			followStream: vi
				.fn()
				.mockImplementation(async (_effortId: string, onChunk: (chunk: StreamChunk) => void) => {
					onChunk(makeChunk("Hel", 0, false));
					onChunk(makeChunk("lo, ", 1, false));
					onChunk(makeChunk("world", 2, false));
					onChunk(
						makeChunk("", 3, true, {
							model: "gpt-5.5",
							tokens_in: 10,
							tokens_out: 5,
						}),
					);
				}),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const written: string[] = [];
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((s: string | Uint8Array) => {
				written.push(String(s));
				return true;
			});

		await command.parseAsync(["hello"], { from: "user" });

		// Each delta was streamed to stdout as it arrived, and joining them yields
		// the whole answer exactly once (the empty final adds nothing).
		expect(written.join("")).toContain("Hello, world");
		expect(written.join("")).not.toContain("Hello, worldHello, world");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("prints subscription pricing mode instead of api cost for subscription providers", async () => {
		const deps = makeDeps({
			followStream: vi
				.fn()
				.mockImplementation(async (_effortId: string, onChunk: (chunk: StreamChunk) => void) => {
					onChunk(
						makeChunk("ok", 0, true, {
							model: "gpt-5.5",
							provider: "openai-codex",
							tokens_in: 50,
							tokens_out: 2,
							pricing_mode: "subscription",
							estimated_usd: 0,
						}),
					);
				}),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello"], { from: "user" });

		const allLogs = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(allLogs).toContain("model:");
		expect(allLogs).toContain("gpt-5.5");
		expect(allLogs).toContain("50 in / 2 out");
		expect(allLogs).toContain("subscription");
		expect(allLogs).not.toContain("~$");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("prints ask result as JSON without streaming text", async () => {
		const deps = makeDeps({
			readActiveSessionId: vi.fn().mockReturnValue("urn:sovereign:session:v1:jsonactive"),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello", "--json"], { from: "user" });

		expect(outSpy).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			effortId: "eff-1",
			sessionId: "urn:sovereign:session:v1:jsonactive",
			content: "hello world",
			command: "ask",
			operation: "submit",
			ok: true,
			nextAction: "refarm resume --json",
			nextActions: ["refarm resume --json", "refarm agent finish --lane after-edit --run --json"],
			nextCommand: "refarm resume --json",
			nextCommands: [
				"refarm resume --json",
				"refarm sessions show urn:sovereign:session:v1:jsonactive --json",
				"refarm agent finish --lane after-edit --run --json",
			],
			metadata: {
				model: "claude-sonnet-4-6",
				tokens_in: 50,
				tokens_out: 100,
				estimated_usd: 0.0005,
			},
		});
		expect(deps.persistActiveSessionId).toHaveBeenCalledWith("urn:sovereign:session:v1:jsonactive");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("uses session fallback when stream and effort result are unavailable", async () => {
		const deps = makeDeps({
			followStream: vi.fn().mockRejectedValue(new Error("stream timeout")),
			readEffortResult: vi.fn().mockResolvedValue(null),
			readSessionFallback: vi.fn().mockResolvedValue({
				status: "ok",
				content: "session answer",
				metadata: { source: "session-history" },
			}),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["hello", "--json"], { from: "user" });

		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(payload).toMatchObject({
			ok: true,
			content: "session answer",
			metadata: { source: "session-history" },
		});
		expect(deps.readSessionFallback).toHaveBeenCalledWith(expect.any(String));
		expect(process.exitCode).toBeUndefined();

		logSpy.mockRestore();
	});

	it("handles --files without failing", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

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
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello"], { from: "user" });

		expect(launchDeps.spawnRuntime).toHaveBeenCalledOnce();
		expect(deps.submitEffort).toHaveBeenCalledOnce();

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("points missing provider failures at model current", async () => {
		process.env.MODEL_PROVIDER = "openai";
		delete process.env.MODEL_DEFAULT_PROVIDER;
		delete process.env.MODEL_BASE_URL;
		delete process.env.OPENAI_API_KEY;
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
		process.env.MODEL_PROVIDER = "openai";
		delete process.env.MODEL_DEFAULT_PROVIDER;
		delete process.env.MODEL_BASE_URL;
		delete process.env.OPENAI_API_KEY;
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
			nextCommand: "refarm sow",
			handoffs: {
				interactive: "refarm sow",
				inspectCurrent: "refarm model current --json",
				inspectProviders: "refarm model providers --json",
				localNoKeyModel: "refarm sow --model ollama/llama3.2 --json",
				openExternalLinks: "refarm config get operator.openExternalLinks --json",
			},
		});
		expect(payload.nextActions).toContain("refarm sow");
		expect(payload.nextActions).toContain("refarm sow --json");
		expect(payload.nextActions).toContain("refarm model current --json");
		expect(payload.nextCommands).toContain("refarm sow");
		expect(payload.nextCommands).toContain("refarm sow --model ollama/llama3.2 --json");
		expect(payload.nextCommands).toContain("refarm sow --json");
		expect(payload.nextCommands).toContain("refarm model providers --json");
		expect(payload.nextCommands).toContain("refarm model current --json");
		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("submits when openai-codex has subscription OAuth credentials", async () => {
		process.env.REFARM_HOME = tempHome ?? "";
		process.env.MODEL_PROVIDER = "openai-codex";
		delete process.env.MODEL_DEFAULT_PROVIDER;
		delete process.env.MODEL_BASE_URL;
		delete process.env.OPENAI_API_KEY;
		fs.mkdirSync(path.join(process.env.REFARM_HOME, ""), { recursive: true });
		fs.writeFileSync(
			path.join(process.env.REFARM_HOME, "identity.json"),
			JSON.stringify({
				tokens: {
					modelProvider: "openai-codex",
					modelId: "gpt-5.5",
					oauthProvider: "openai-codex",
					oauthCredentials: {
						"openai-codex": { access: "oauth-access-test" },
					},
				},
			}),
		);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
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
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(payload).toMatchObject({
			ok: true,
			content: "hello world",
		});
		expect(deps.submitEffort).toHaveBeenCalledOnce();
		expect(process.exitCode).toBeUndefined();

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	/**
	 * REPINNED FORWARD 2026-08-17 (ISS-141). This test used `github-copilot` as its example of a
	 * subscription provider the runtime cannot dispatch through, and that stopped being true when
	 * the adapter landed. The GUARD is unchanged and still asserted — what changed is which
	 * providers it applies to, and the honest assertion now is that Copilot SUBMITS.
	 *
	 * No declared subscription provider is currently unsupported, so there is no real value left to
	 * exercise the refusal with. Inventing one would test a fiction; asserting the new truth keeps
	 * this file describing the node that exists.
	 */
	it("SUBMITS for github-copilot from env, which the runtime can now dispatch", async () => {
		process.env.REFARM_HOME = tempHome ?? "";
		process.env.MODEL_PROVIDER = "github-copilot";
		process.env.MODEL_ID = "gpt-4o";
		process.env.GITHUB_COPILOT_ACCESS_TOKEN = "copilot-access-test";
		delete process.env.MODEL_DEFAULT_PROVIDER;
		delete process.env.OPENAI_API_KEY;
		delete process.env.OPENAI_CODEX_ACCESS_TOKEN;
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
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
		const printed = String(logSpy.mock.calls[0]?.[0] ?? "");
		expect(printed).not.toContain("model-subscription-runtime-unsupported");
		expect(deps.submitEffort).toHaveBeenCalled();

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("fails before submitting when runtime reports no loaded agent", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			readPluginState: vi.fn().mockResolvedValue({
				installed: ["@refarm/agent"],
				loaded: [],
				known: ["@refarm/agent"],
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
		expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("No agent is loaded"));
		expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("Reload runtime plugins"));
		expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("/reload agent"));
		expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("/r agent"));
		expect(process.exitCode).toBe(1);

		errSpy.mockRestore();
	});

	it("prints agent readiness failures as JSON when requested", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			readPluginState: vi.fn().mockResolvedValue({
				installed: ["@refarm/agent"],
				loaded: [],
				known: ["@refarm/agent"],
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
			error: "agent-not-loaded",
			nextAction: "refarm plugin reload agent --json",
			nextCommand: "refarm plugin reload agent --json",
		});
		expect(payload.nextActions).toContain("refarm plugin reload agent --json");
		expect(payload.nextActions).not.toContain("/reload @refarm/agent");
		expect(payload.nextActions).toContain("refarm runtime start");
		expect(payload.nextCommands).toContain("refarm runtime ensure --wait --next-command");
		expect(payload.nextCommands).toContain("refarm runtime start --wait");
		expect(payload.nextCommands).toContain("refarm doctor --next-command");
		expect(payload.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "agent-not-loaded",
				command: "refarm plugin reload agent --json",
			}),
		]);
		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("prints plugin install recovery as JSON when the runtime agent is missing", async () => {
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
			error: "agent-not-loaded",
			nextAction: "refarm plugin install",
			nextCommand: "refarm plugin install --json",
		});
		expect(payload.nextActions).toContain("refarm plugin install");
		expect(payload.nextActions).not.toContain("/reload @refarm/agent");
		expect(payload.nextCommands).toContain("refarm plugin install --json");
		expect(payload.nextCommands).not.toContain("refarm plugin install");
		expect(payload.recommendations).toEqual([
			expect.objectContaining({
				diagnostic: "agent-not-loaded",
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
				.mockRejectedValue(new Error('model-bridge request failed for provider "openai"')),
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
			nextAction: "refarm model current --json",
			nextCommand: "refarm model current --json",
			nextActions: [
				"refarm model current --json",
				"refarm model providers --json",
				"refarm model openai/gpt-5.6-sol --json",
				"refarm sow --json",
			],
			nextCommands: [
				"refarm model current --json",
				"refarm model providers --json",
				"refarm model openai/gpt-5.6-sol --json",
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

	it("classifies runtime submit errors for configured runtime agent id as agent-not-loaded", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			readPluginState: vi.fn().mockResolvedValue({
				installed: [RUNTIME_AGENT_PLUGIN_ID],
				loaded: [],
				known: [RUNTIME_AGENT_PLUGIN_ID],
			}),
			submitEffort: vi.fn().mockRejectedValue(new Error(`${RUNTIME_AGENT_PLUGIN_ID} not loaded`)),
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
			error: "agent-not-loaded",
			nextActions: expect.arrayContaining(["refarm plugin reload agent --json"]),
		});
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("classifies runtime submit errors using short agent id as agent-not-loaded", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const runtimeAgentShortId = RUNTIME_AGENT_PLUGIN_ID.split("/").at(-1) ?? "";
		const deps = makeDeps({
			readPluginState: vi.fn().mockResolvedValue({
				installed: [RUNTIME_AGENT_PLUGIN_ID],
				loaded: [],
				known: [RUNTIME_AGENT_PLUGIN_ID],
			}),
			submitEffort: vi.fn().mockRejectedValue(new Error(`${runtimeAgentShortId} not loaded`)),
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
			error: "agent-not-loaded",
			nextActions: expect.arrayContaining(["refarm plugin reload agent --json"]),
		});
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("classifies sidecar-style agent-not-loaded payloads as agent-not-loaded", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			readPluginState: vi.fn().mockResolvedValue({
				installed: [RUNTIME_AGENT_PLUGIN_ID],
				loaded: [],
				known: [RUNTIME_AGENT_PLUGIN_ID],
			}),
			submitEffort: vi
				.fn()
				.mockRejectedValue(
					new Error(
						`[agent not loaded (${RUNTIME_AGENT_PLUGIN_ID}) - run refarm plugin status, then refarm plugin install or reload]`,
					),
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
			error: "agent-not-loaded",
			nextActions: expect.arrayContaining(["refarm plugin reload agent --json"]),
		});
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("reloads the installed runtime agent before submitting when it is not loaded", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			readPluginState: vi
				.fn()
				.mockResolvedValueOnce({
					installed: ["@refarm/agent"],
					loaded: [],
					known: ["@refarm/agent"],
				})
				.mockResolvedValueOnce({
					installed: ["@refarm/agent"],
					loaded: ["@refarm/agent"],
					known: ["@refarm/agent"],
				}),
			reloadPlugins: vi.fn().mockResolvedValue({
				reloaded: ["@refarm/agent"],
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
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello"], { from: "user" });

		expect(deps.reloadPlugins).toHaveBeenCalledWith(["@refarm/agent"]);
		expect(deps.submitEffort).toHaveBeenCalledOnce();

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("reports skipped agent auto-reloads as JSON failures", async () => {
		process.env.MODEL_PROVIDER = "openai";
		process.env.OPENAI_API_KEY = "sk-test";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		const deps = makeDeps({
			readPluginState: vi.fn().mockResolvedValue({
				installed: ["@refarm/agent"],
				loaded: [],
				known: ["@refarm/agent"],
			}),
			reloadPlugins: vi.fn().mockResolvedValue({
				reloaded: [],
				deferred: [],
				skipped: ["@refarm/agent"],
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
			error: "agent-reload-failed",
			message: "Agent reload was requested but the runtime skipped it.",
			installed: true,
			reloaded: [],
			deferred: [],
			skipped: ["@refarm/agent"],
			nextAction: "refarm plugin reload agent --json",
			nextCommand: "refarm plugin reload agent --json",
			nextCommands: [
				"refarm plugin reload agent --json",
				"refarm runtime ensure --wait --next-command",
				"refarm doctor --next-command",
			],
			recommendations: [
				expect.objectContaining({
					diagnostic: "agent-reload-failed",
					command: "refarm plugin reload agent --json",
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
			readActiveSessionId: vi.fn().mockReturnValue("urn:sovereign:session:v1:oldactive"),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["fresh please", "--new"], { from: "user" });

		expect(deps.clearActiveSessionId).toHaveBeenCalledOnce();
		expect(deps.submitEffort).toHaveBeenCalledWith(
			expect.objectContaining({
				tasks: [
					expect.objectContaining({
						args: expect.objectContaining({
							session_id: expect.stringMatching(/^urn:sovereign:session:v1:/),
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
							session_id: "urn:sovereign:session:v1:oldactive",
						}),
					}),
				],
			}),
		);
		const effort = vi.mocked(deps.submitEffort).mock.calls[0]![0] as {
			tasks: Array<{ args: { session_id: string } }>;
		};
		const submittedSessionId = effort.tasks[0]!.args.session_id;
		expect(deps.persistActiveSessionId).toHaveBeenCalledWith(submittedSessionId);
		expect(submittedSessionId).not.toBe("urn:sovereign:session:v1:oldactive");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("falls back to effort result file payload when stream times out", async () => {
		const deps = makeDeps({
			readActiveSessionId: vi.fn().mockReturnValue("urn:sovereign:session:v1:activefallback"),
			followStream: vi.fn().mockRejectedValue(new Error("stream timeout")),
			readEffortResult: vi.fn().mockResolvedValue({
				status: "ok",
				content: "fallback response",
				metadata: { model: "mock-model", tokens_in: 1, tokens_out: 2 },
			}),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["fallback please"], { from: "user" });

		expect(deps.followStream).toHaveBeenCalledOnce();
		expect(deps.readEffortResult).toHaveBeenCalledWith("eff-1");
		expect(deps.persistActiveSessionId).toHaveBeenCalledWith(
			"urn:sovereign:session:v1:activefallback",
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
			readActiveSessionId: vi.fn().mockReturnValue("urn:sovereign:session:v1:jsonfallback"),
			followStream: vi.fn().mockRejectedValue(new Error("stream timeout")),
			readEffortResult: vi.fn().mockResolvedValue({
				status: "ok",
				content: "fallback response",
				metadata: { model: "mock-model", tokens_in: 1, tokens_out: 2 },
			}),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["fallback please", "--json"], { from: "user" });

		expect(outSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual({
			effortId: "eff-1",
			sessionId: "urn:sovereign:session:v1:jsonfallback",
			content: "fallback response",
			command: "ask",
			operation: "submit",
			ok: true,
			nextAction: "refarm resume --json",
			nextActions: ["refarm resume --json", "refarm agent finish --lane after-edit --run --json"],
			nextCommand: "refarm resume --json",
			nextCommands: [
				"refarm resume --json",
				"refarm sessions show urn:sovereign:session:v1:jsonfallback --json",
				"refarm agent finish --lane after-edit --run --json",
			],
			metadata: { model: "mock-model", tokens_in: 1, tokens_out: 2 },
		});

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("reports quota fallback errors as JSON recovery handoffs", async () => {
		const deps = makeDeps({
			readActiveSessionId: vi.fn().mockReturnValue("urn:sovereign:session:v1:quota"),
			followStream: vi.fn().mockRejectedValue(new Error("stream timeout")),
			readEffortResult: vi.fn().mockResolvedValue({
				status: "error",
				error:
					"[runtime-agent error] You exceeded your current quota, please check your plan and billing details.",
			}),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello", "--json"], { from: "user" });

		expect(errSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			ok: false,
			error: "model-quota-exceeded",
			nextAction: "refarm model current --json",
			nextCommand: "refarm model current --json",
			nextCommands: [
				"refarm model current --json",
				"refarm sow --json",
				"refarm model providers --json",
				"refarm model openai/gpt-5.6-sol --json",
			],
		});
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("reports runtime-agent final provider errors as JSON recovery handoffs", async () => {
		const deps = makeDeps({
			readActiveSessionId: vi.fn().mockReturnValue("urn:sovereign:session:v1:providerdown"),
			followStream: vi
				.fn()
				.mockImplementation(async (_effortId: string, onChunk: (chunk: StreamChunk) => void) => {
					onChunk(
						makeChunk(
							"[runtime-agent error] http error: http://localhost:11434/v1/chat/completions: Connection Failed: Connect error: Connection refused (os error 111)",
							0,
							true,
							{ model: "llama3.2" },
						),
					);
				}),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello", "--json"], { from: "user" });

		expect(errSpy).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			ok: false,
			error: "model-provider-unavailable",
			provider: "ollama",
			nextAction: "refarm model doctor --json",
			nextCommand: "refarm model doctor --json",
			nextCommands: [
				"refarm model doctor --json",
				"ollama serve",
				"refarm model base-url http://host.docker.internal:11434 --json",
				"refarm model current --json",
				"refarm model providers --json",
			],
		});
		expect(deps.persistActiveSessionId).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it("uses explicit --session value in effort payload", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello", "--session", "urn:sovereign:session:v1:test123"], {
			from: "user",
		});

		expect(deps.submitEffort).toHaveBeenCalledWith(
			expect.objectContaining({
				tasks: [
					expect.objectContaining({
						args: expect.objectContaining({
							session_id: "urn:sovereign:session:v1:test123",
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
			resolveSessionIdPrefix: vi.fn().mockResolvedValue("urn:sovereign:session:v1:resolved123"),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await command.parseAsync(["hello", "--session", "resolved123"], {
			from: "user",
		});

		expect(deps.resolveSessionIdPrefix).toHaveBeenCalledWith("resolved123");
		expect(deps.submitEffort).toHaveBeenCalledWith(
			expect.objectContaining({
				tasks: [
					expect.objectContaining({
						args: expect.objectContaining({
							session_id: "urn:sovereign:session:v1:resolved123",
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
					'Session switch expected active session "urn:sovereign:session:v1:target", got "urn:sovereign:session:v1:other".',
				);
			}),
		});
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello", "--session", "urn:sovereign:session:v1:target"], {
			from: "user",
		});

		expect(deps.submitEffort).toHaveBeenCalledOnce();
		expect(deps.persistActiveSessionId).toHaveBeenCalledWith("urn:sovereign:session:v1:target");
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
				.mockRejectedValue(new Error('Ambiguous session prefix "abc" (2 matches)')),
		});
		const command = createAskCommand(deps);
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["hello", "--session", "abc"], {
			from: "user",
		});

		expect(deps.submitEffort).not.toHaveBeenCalled();
		expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Ambiguous session prefix "abc"'));
		expect(process.exitCode).toBe(1);

		errSpy.mockRestore();
	});

	it("prints session prefix failures as JSON with executable recovery command", async () => {
		const deps = makeDeps({
			resolveSessionIdPrefix: vi
				.fn()
				.mockRejectedValue(new Error('Ambiguous session prefix "abc" (2 matches)')),
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

		await command.parseAsync(["hello", "--new", "--session", "urn:sovereign:session:v1:test123"], {
			from: "user",
		});

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
			["hello", "--new", "--session", "urn:sovereign:session:v1:test123", "--json"],
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

// ISS-061. `--session <prefix>` made two round trips to /sessions: one to turn the prefix into a
// full id, one to read that session's workspace declaration. The wasted fetch is the small half —
// the real one is that they were two reads of a MOVING list, so a prefix resolved against one
// snapshot and a declaration read from another can disagree about which sessions exist, and the
// second read's `undefined` ("no declaration") becomes indistinguishable from "not in this snapshot".
describe("one invocation, one sessions snapshot (ISS-061)", () => {
	afterEach(() => {
		resetSessionsSnapshotForTests();
	});

	it("two readers share ONE execution", () => {
		// The property, provable without a network: `onceAsync` is what makes the two /sessions
		// readers agree on a snapshot instead of racing two reads of a moving list.
		let runs = 0;
		const once = onceAsync(async () => {
			runs += 1;
			return ["a"];
		});
		const first = once.run();
		const second = once.run();
		expect(second).toBe(first);
		return first.then(() => {
			expect(runs).toBe(1);
		});
	});

	it("reset lets a second answer be stated — one invocation, one snapshot, not one per process", async () => {
		let runs = 0;
		const once = onceAsync(async () => {
			runs += 1;
			return runs;
		});
		expect(await once.run()).toBe(1);
		once.reset();
		expect(await once.run()).toBe(2);
	});

	it("a failed read is null, never an empty list — an empty list is a node with no sessions", async () => {
		resetSessionsSnapshotForTests();
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
			throw new Error("ECONNREFUSED");
		});
		try {
			expect(await loadSessionsSnapshot()).toBeNull();
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("a body with no sessions array is a failed read, not an empty answer", async () => {
		resetSessionsSnapshotForTests();
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }),
		);
		try {
			expect(await loadSessionsSnapshot()).toBeNull();
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
