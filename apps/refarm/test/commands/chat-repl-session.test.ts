import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_HELP_TEXT } from "@refarm.dev/cli/chat-repl";

const MAX_CHAT_HISTORY_LINES = 500;

import type { ChatDeps } from "../../src/commands/chat.js";
import { runSessionRepl } from "../../src/commands/chat.js";

const mockedCreateInterface = vi.hoisted(() => vi.fn());
const mockedLaunchProcess = vi.hoisted(() => vi.fn());
const mockedLoadChatHistory = vi.hoisted(() => vi.fn().mockReturnValue([]));
const mockedSaveChatHistory = vi.hoisted(() => vi.fn());

vi.mock("node:readline", () => ({
	default: {
		createInterface: mockedCreateInterface,
	},
	createInterface: mockedCreateInterface,
}));

vi.mock("@refarm.dev/cli/launch-process", () => ({
	launchProcess: mockedLaunchProcess,
}));

vi.mock("@refarm.dev/cli/chat-history", () => ({
	MAX_CHAT_HISTORY_LINES: 500,
	loadChatHistory: mockedLoadChatHistory,
	rememberChatHistoryLine: vi
		.fn()
		.mockImplementation((history: string[], line: string) => [
			...history,
			line,
		]),
	saveChatHistory: mockedSaveChatHistory,
	resolveChatHistoryPath: vi.fn(),
}));

type FakeReadlineInterface = EventEmitter & {
	prompt: () => void;
	pause: () => void;
	resume: () => void;
	close: () => void;
	history: string[];
	line: string;
};

function createFakeReadline(): FakeReadlineInterface {
	const rl = new EventEmitter() as FakeReadlineInterface;
	rl.prompt = vi.fn() as () => void;
	rl.pause = vi.fn() as () => void;
	rl.resume = vi.fn() as () => void;
	rl.close = vi.fn(() => {
		rl.emit("close");
	}) as () => void;
	rl.history = [];
	rl.line = "";
	return rl;
}

describe("runSessionRepl", () => {
	let lastInterface: FakeReadlineInterface;

	beforeEach(() => {
		mockedCreateInterface.mockImplementation(() => {
			lastInterface = createFakeReadline();
			return lastInterface;
		});
		mockedLoadChatHistory.mockReturnValue([]);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("passes readline history size and terminal options", async () => {
		runSessionRepl("urn:refarm:session:v1:test", {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		});

		expect(mockedCreateInterface).toHaveBeenCalledTimes(1);
		expect(mockedCreateInterface).toHaveBeenCalledWith(
			expect.objectContaining({
				historySize: 1000,
				terminal: true,
			}),
		);
	});

	it("prints resume hints when the REPL closes without an explicit /exit", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		};

		const sessionId = "urn:refarm:session:v1:test";
		runSessionRepl(sessionId, deps);
		lastInterface.emit("close");
		await Promise.resolve();

		const out = logs.join("\n");
		expect(out).toContain(
			`To continue this session, run: refarm session --session ${sessionId}`,
		);
		expect(out).toContain(
			"To inspect next operator action, run: refarm resume --next-action",
		);
		expect((out.match(/To continue this session/g) ?? []).length).toBe(1);

		consoleSpy.mockRestore();
	});

	it("prints codex-style hints on SIGINT", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		};

		const sessionId = "urn:refarm:session:v1:test";
		runSessionRepl(sessionId, deps);
		lastInterface.emit("SIGINT");
		await Promise.resolve();

		const out = logs.join("\n");
		expect(out).toContain("Goodbye.");
		expect(out).toContain(
			`To continue this session, run: refarm session --session ${sessionId}`,
		);
		expect(out).toContain(
			"To inspect next operator action, run: refarm resume --next-action",
		);

		consoleSpy.mockRestore();
	});

	it("executes /status without exiting", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});
		mockedLaunchProcess.mockResolvedValue(0);

		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		};

		runSessionRepl("urn:refarm:session:v1:test", deps);
		lastInterface.emit("line", "/status");
		await Promise.resolve();
		await Promise.resolve();

		expect(mockedLaunchProcess).toHaveBeenCalledWith({
			command: process.argv[0],
			args: [process.argv[1], "status"],
			display: "refarm status",
		});
		expect(logs.join("\n")).not.toContain("Goodbye.");
		expect(logs.join("\n")).not.toContain("To continue this session");

		consoleSpy.mockRestore();
	});

	it("prints status failure path and continues", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation(() => undefined);
		const errorSpy = vi
			.spyOn(console, "error")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});
		mockedLaunchProcess.mockResolvedValue(2);

		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		};

		runSessionRepl("urn:refarm:session:v1:test", deps);
		lastInterface.emit("line", "/status");
		await Promise.resolve();
		await Promise.resolve();

		expect(
			errorSpy.mock.calls.map((call) => String(call[0])).join("\n"),
		).toContain("Status command exited with 2");

		const out = logs.join("\n");
		expect(out).not.toContain("Goodbye.");

		consoleSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("prints chat history on /history", async () => {
		mockedLoadChatHistory.mockReturnValue(["one", "two"]);
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		runSessionRepl("urn:refarm:session:v1:test", {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		});
		lastInterface.emit("line", "/history");
		await Promise.resolve();

		const out = logs.join("\n");
		expect(out).toContain("1. one");
		expect(out).toContain("2. two");
		expect(out).not.toContain("Goodbye.");

		consoleSpy.mockRestore();
	});

	it("does not persist history when chat history does not change", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		runSessionRepl("urn:refarm:session:v1:test", {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		});
		lastInterface.emit("close");
		await Promise.resolve();

		expect(mockedSaveChatHistory).not.toHaveBeenCalled();
		expect(logs.join("\n")).toContain("Session saved.");

		consoleSpy.mockRestore();
	});

	it("persists history when message input is added", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		runSessionRepl("urn:refarm:session:v1:test", {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		});
		lastInterface.emit("line", "first message");
		await Promise.resolve();
		lastInterface.emit("close");
		await Promise.resolve();

		expect(mockedSaveChatHistory).toHaveBeenCalledTimes(1);
		expect(logs.join("\n")).toContain("Session saved.");

		consoleSpy.mockRestore();
	});

	it("includes slash commands in /history output", async () => {
		mockedLoadChatHistory.mockReturnValue(["one"]);
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		runSessionRepl("urn:refarm:session:v1:test", {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		});
		lastInterface.emit("line", "/new");
		await Promise.resolve();
		lastInterface.emit("line", "message line");
		await Promise.resolve();
		lastInterface.emit("line", "/history");
		await Promise.resolve();

		const out = logs.join("\n");
		expect(out).toContain("1. message line");
		expect(out).toContain("2. /new");
		expect(out).toContain("3. one");

		consoleSpy.mockRestore();
	});

	it("caps in-session command history to MAX_CHAT_HISTORY_LINES", async () => {
		mockedLoadChatHistory.mockReturnValue([]);
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		runSessionRepl("urn:refarm:session:v1:test", {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		});
		for (let index = 0; index < MAX_CHAT_HISTORY_LINES + 5; index++) {
			lastInterface.emit("line", `message-${index}`);
			await Promise.resolve();
		}
		lastInterface.emit("line", "/history");
		await Promise.resolve();

		const out = logs.join("\n");
		expect(out).toContain(`1. message-${MAX_CHAT_HISTORY_LINES + 4}`);
		expect(out).toContain(
			`${MAX_CHAT_HISTORY_LINES}. message-${MAX_CHAT_HISTORY_LINES + 5 - MAX_CHAT_HISTORY_LINES}`,
		);
		expect(out).not.toContain("message-0");
		expect(out).not.toContain("message-4");

		consoleSpy.mockRestore();
	});

	it("caps combined history output to MAX_CHAT_HISTORY_LINES", async () => {
		mockedLoadChatHistory.mockReturnValue(
			Array.from({ length: MAX_CHAT_HISTORY_LINES }, (_, i) => `history-${i}`),
		);
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		runSessionRepl("urn:refarm:session:v1:test", {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		});
		for (let index = 0; index < 10; index++) {
			lastInterface.emit("line", `message-${index}`);
			await Promise.resolve();
		}
		lastInterface.emit("line", "/history");
		await Promise.resolve();

		const out = logs.join("\n");
		const lines = out
			.split("\n")
			.filter((line) => /^\d+\. /.test(line.trim()))
			.length;
		expect(lines).toBe(MAX_CHAT_HISTORY_LINES);
		expect(out).not.toContain("history-499");
		expect(out).toContain("1. message-9");
		expect(out).toContain(`500. history-489`);

		consoleSpy.mockRestore();
	});

	it("clears chat history on /history --clear", async () => {
		mockedLoadChatHistory.mockReturnValue(["one", "two"]);
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		runSessionRepl("urn:refarm:session:v1:test", {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		});
		lastInterface.emit("line", "/history --clear");
		await Promise.resolve();
		lastInterface.emit("close");
		await Promise.resolve();

		expect(mockedSaveChatHistory).toHaveBeenCalledWith([]);
		expect(logs.join("\n")).toContain("Chat history cleared");
		expect(logs.join("\n")).not.toContain("No chat history yet.");

		consoleSpy.mockRestore();
	});

	it("clears chat history on /history clear", async () => {
		mockedLoadChatHistory.mockReturnValue(["one", "two"]);
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		runSessionRepl("urn:refarm:session:v1:test", {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		});
		lastInterface.emit("line", "/history clear");
		await Promise.resolve();
		lastInterface.emit("close");
		await Promise.resolve();

		expect(mockedSaveChatHistory).toHaveBeenCalledWith([]);
		expect(logs.join("\n")).toContain("Chat history cleared");
		expect(logs.join("\n")).not.toContain("No chat history yet.");

		consoleSpy.mockRestore();
	});

	it("clears chat history on /clear", async () => {
		mockedLoadChatHistory.mockReturnValue(["one", "two"]);
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		runSessionRepl("urn:refarm:session:v1:test", {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		});
		lastInterface.emit("line", "/clear");
		await Promise.resolve();
		lastInterface.emit("close");
		await Promise.resolve();

		expect(mockedSaveChatHistory).toHaveBeenCalledWith([]);
		expect(logs.join("\n")).toContain("Chat history cleared");
		expect(logs.join("\n")).not.toContain("No chat history yet.");

		consoleSpy.mockRestore();
	});

	it("does not persist history for /history --clear when already empty", async () => {
		mockedLoadChatHistory.mockReturnValue([]);
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		runSessionRepl("urn:refarm:session:v1:test", {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		});
		lastInterface.emit("line", "/history --clear");
		await Promise.resolve();
		lastInterface.emit("close");
		await Promise.resolve();

		expect(mockedSaveChatHistory).not.toHaveBeenCalled();
		expect(logs.join("\n")).toContain("✓ Chat history cleared.");

		consoleSpy.mockRestore();
	});

	it("forwards /sow credentials command to configure hook", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});
		const configureCredentials = vi.fn().mockResolvedValue(undefined);

		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
			configureCredentials,
		};

		runSessionRepl("urn:refarm:session:v1:test", deps);
		lastInterface.emit("line", "/sow --provider openai");
		await Promise.resolve();
		await Promise.resolve();

		expect(configureCredentials).toHaveBeenCalledWith(["--provider", "openai"]);
		const out = logs.join("\n");
		expect(out).toContain(
			"Refarm runtime reloads saved credentials before each task.",
		);

		consoleSpy.mockRestore();
	});

	it("forwards /keys to configure hook with reconfigure flag", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});
		const configureCredentials = vi.fn().mockResolvedValue(undefined);

		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
			configureCredentials,
		};

		runSessionRepl("urn:refarm:session:v1:test", deps);
		lastInterface.emit("line", "/keys");
		await Promise.resolve();
		await Promise.resolve();

		expect(configureCredentials).toHaveBeenCalledWith(["--reconfigure"]);
		const out = logs.join("\n");
		expect(out).toContain(
			"Refarm runtime reloads saved credentials before each task.",
		);

		consoleSpy.mockRestore();
	});

	it("prints status command exception and continues", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation(() => undefined);
		const errorSpy = vi
			.spyOn(console, "error")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});
		mockedLaunchProcess.mockRejectedValue(new Error("launch exploded"));

		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		};

		runSessionRepl("urn:refarm:session:v1:test", deps);
		lastInterface.emit("line", "/status");
		await Promise.resolve();
		await Promise.resolve();

		expect(
			errorSpy.mock.calls.map((call) => String(call[0])).join("\n"),
		).toContain("launch exploded");

		const out = logs.join("\n");
		expect(out).not.toContain("Goodbye.");

		consoleSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("prints help text and does not emit session resume hints", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		};

		runSessionRepl("urn:refarm:session:v1:test", deps);
		lastInterface.emit("line", "/help");
		await Promise.resolve();

		const out = logs.join("\n");
		expect(out).toContain(CHAT_HELP_TEXT);
		expect(out).not.toContain("To continue this session");
		expect(out).not.toContain("Goodbye.");

		consoleSpy.mockRestore();
	});

	it("prints resume hints exactly once on /exit", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		};

		const sessionId = "urn:refarm:session:v1:test";
		runSessionRepl(sessionId, deps);
		lastInterface.emit("line", "/exit");
		await Promise.resolve();

		const out = logs.join("\n");
		expect(out).toContain("Goodbye.");
		expect(out).toContain(
			`To continue this session, run: refarm session --session ${sessionId}`,
		);
		expect(out).toContain(
			"To inspect next operator action, run: refarm resume --next-action",
		);
		expect((out.match(/To continue this session/g) ?? []).length).toBe(1);
		expect((out.match(/Session saved\./g) ?? []).length).toBe(1);

		consoleSpy.mockRestore();
	});

	it("treats /quit as /exit", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
		};

		const sessionId = "urn:refarm:session:v1:test";
		runSessionRepl(sessionId, deps);
		lastInterface.emit("line", "/quit");
		await Promise.resolve();

		const out = logs.join("\n");
		expect(out).toContain("Goodbye.");
		expect(out).toContain(
			`To continue this session, run: refarm session --session ${sessionId}`,
		);
		expect(out).toContain(
			"To inspect next operator action, run: refarm resume --next-action",
		);
		expect((out.match(/To continue this session/g) ?? []).length).toBe(1);
		expect((out.match(/Session saved\./g) ?? []).length).toBe(1);

		consoleSpy.mockRestore();
	});

	it("uses updated session id in resume hints after /session", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		const nextSessionId = "urn:refarm:session:v1:switched";
		const persistActiveSessionId = vi.fn();
		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
			resolveSessionIdPrefix: vi.fn().mockResolvedValue(nextSessionId),
			persistActiveSessionId,
		};

		runSessionRepl("urn:refarm:session:v1:test", deps);
		lastInterface.emit("line", "/session switched");
		await Promise.resolve();
		await Promise.resolve();
		lastInterface.emit("line", "/exit");
		await Promise.resolve();

		expect(deps.resolveSessionIdPrefix).toHaveBeenCalledWith("switched");
		expect(persistActiveSessionId).toHaveBeenCalledWith(nextSessionId);
		const out = logs.join("\n");
		expect(out).toContain(
			`To continue this session, run: refarm session --session ${nextSessionId}`,
		);
		expect((out.match(/To continue this session/g) ?? []).length).toBe(1);

		consoleSpy.mockRestore();
	});

	it("keeps prior session id when /session fails", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		const oldSessionId = "urn:refarm:session:v1:test";
		const resolveSessionIdPrefix = vi
			.fn()
			.mockRejectedValue(new Error("No session matching: missing"));
		const persistActiveSessionId = vi.fn();
		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
			resolveSessionIdPrefix,
			persistActiveSessionId,
		};

		runSessionRepl(oldSessionId, deps);
		lastInterface.emit("line", "/session missing");
		await Promise.resolve();
		await Promise.resolve();
		lastInterface.emit("line", "/exit");
		await Promise.resolve();

		expect(resolveSessionIdPrefix).toHaveBeenCalledWith("missing");
		expect(persistActiveSessionId).not.toHaveBeenCalled();
		const out = logs.join("\n");
		expect(out).toContain(
			`To continue this session, run: refarm session --session ${oldSessionId}`,
		);
		expect(out).not.toContain(
			"To continue this session, run: refarm session --session urn:refarm:session:v1:missing",
		);
		expect((out.match(/To continue this session/g) ?? []).length).toBe(1);

		consoleSpy.mockRestore();
	});

	it("restarts session on /new and uses new session in resume hints", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		const generatedSession = "urn:refarm:session:v1:".concat(
			"11111111-2222-3333-4444-555555555555".replace(/-/g, ""),
		);
		const randomUUIDSpy = vi
			.spyOn(crypto, "randomUUID")
			.mockReturnValue("11111111-2222-3333-4444-555555555555");
		const clearActiveSessionId = vi.fn();
		const persistActiveSessionId = vi.fn();
		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
			clearActiveSessionId,
			persistActiveSessionId,
		};

		runSessionRepl("urn:refarm:session:v1:test", deps);
		lastInterface.emit("line", "/new");
		await Promise.resolve();
		await Promise.resolve();
		lastInterface.emit("line", "/exit");
		await Promise.resolve();

		expect(clearActiveSessionId).toHaveBeenCalledOnce();
		expect(persistActiveSessionId).toHaveBeenCalledWith(generatedSession);
		const out = logs.join("\n");
		expect(out).toContain(
			`To continue this session, run: refarm session --session ${generatedSession}`,
		);
		expect((out.match(/To continue this session/g) ?? []).length).toBe(1);

		randomUUIDSpy.mockRestore();
		consoleSpy.mockRestore();
	});
});
