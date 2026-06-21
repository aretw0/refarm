import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChatDeps } from "../../src/commands/chat.js";
import { runSessionRepl } from "../../src/commands/chat.js";

const mockedCreateInterface = vi.hoisted(() => vi.fn());

vi.mock("node:readline", () => ({
	default: {
		createInterface: mockedCreateInterface,
	},
	createInterface: mockedCreateInterface,
}));

vi.mock("../../src/commands/chat-history.js", () => ({
	loadChatHistory: vi.fn().mockReturnValue([]),
	rememberChatHistoryLine: vi
		.fn()
		.mockImplementation((history: string[], line: string) => [
			...history,
			line,
		]),
	saveChatHistory: vi.fn(),
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
	});

	afterEach(() => {
		vi.clearAllMocks();
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

	it("uses updated session id in resume hints after /session", async () => {
		const logs: string[] = [];
		const consoleSpy = vi
			.spyOn(console, "log")
			.mockImplementation((...args) => {
				logs.push(String(args[0]));
				return undefined;
			});

		const nextSessionId = "urn:refarm:session:v1:switched";
		const deps: ChatDeps = {
			submitEffort: vi.fn(),
			followStream: vi.fn(),
			reloadPlugins: vi.fn(),
			resolveSessionIdPrefix: vi.fn().mockResolvedValue(nextSessionId),
		};

		runSessionRepl("urn:refarm:session:v1:test", deps);
		lastInterface.emit("line", "/session switched");
		await Promise.resolve();
		await Promise.resolve();
		lastInterface.emit("line", "/exit");
		await Promise.resolve();

		expect(deps.resolveSessionIdPrefix).toHaveBeenCalledWith("switched");
		const out = logs.join("\n");
		expect(out).toContain(
			`To continue this session, run: refarm session --session ${nextSessionId}`,
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

		const generatedSession =
			"urn:refarm:session:v1:".concat("11111111-2222-3333-4444-555555555555".replace(/-/g, ""));
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
