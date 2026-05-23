import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockAutoStartRuntime,
	mockCheckSessionReadiness,
	mockDefaultChatDeps,
	mockFindRepoRoot,
	mockIsFirstRun,
	mockPrintOnboarding,
	mockPrintSessionGuide,
	mockRunSessionRepl,
} = vi.hoisted(() => ({
	mockAutoStartRuntime: vi.fn().mockResolvedValue(false),
	mockCheckSessionReadiness: vi.fn().mockResolvedValue({
		providerConfigured: true,
		runtimeRunning: true,
		farmhandRunning: true,
	}),
	mockDefaultChatDeps: vi.fn().mockReturnValue({}),
	mockFindRepoRoot: vi.fn().mockReturnValue("/workspaces/refarm"),
	mockIsFirstRun: vi.fn().mockReturnValue(false),
	mockPrintOnboarding: vi.fn(),
	mockPrintSessionGuide: vi.fn(),
	mockRunSessionRepl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/commands/session-launch.js", () => ({
	autoStartRuntime: mockAutoStartRuntime,
	checkSessionReadiness: mockCheckSessionReadiness,
	defaultLaunchDeps: vi.fn().mockReturnValue({}),
	findRepoRoot: mockFindRepoRoot,
	isFirstRun: mockIsFirstRun,
	isRuntimeRunning: vi.fn((readiness) => Boolean(readiness.runtimeRunning)),
	isSessionReady: vi.fn(
		(readiness) =>
			Boolean(readiness.providerConfigured) && Boolean(readiness.runtimeRunning),
	),
	printOnboarding: mockPrintOnboarding,
	printSessionGuide: mockPrintSessionGuide,
}));

vi.mock("../../src/commands/chat.js", () => ({
	defaultChatDeps: mockDefaultChatDeps,
	runSessionRepl: mockRunSessionRepl,
}));

import {
	createSessionCommand,
	runSessionLaunchFlow,
} from "../../src/commands/session.js";

describe("session command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		mockCheckSessionReadiness.mockResolvedValue({
			providerConfigured: true,
			runtimeRunning: true,
			farmhandRunning: true,
		});
		mockDefaultChatDeps.mockReturnValue({});
		mockIsFirstRun.mockReturnValue(false);
		mockRunSessionRepl.mockResolvedValue(undefined);
	});

	it("documents bare refarm parity and REPL runtime commands in help", () => {
		let help = "";
		const command = createSessionCommand();
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});
		command.outputHelp();

		expect(help).toContain("refarm session --new");
		expect(help).toContain("Bare refarm runs the same launch flow");
		expect(help).toContain("/model, /login, and /reload");
	});

	it("sets exitCode and returns when readiness is not sufficient", async () => {
		mockCheckSessionReadiness.mockResolvedValue({
			providerConfigured: false,
			runtimeRunning: false,
			farmhandRunning: false,
		});

		await expect(runSessionLaunchFlow()).resolves.toBeUndefined();

		expect(mockPrintSessionGuide).toHaveBeenCalledWith(
			expect.objectContaining({ providerConfigured: false }),
		);
		expect(mockRunSessionRepl).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});

	it("returns after onboarding without forcing process exit", async () => {
		mockIsFirstRun.mockReturnValue(true);

		await expect(runSessionLaunchFlow()).resolves.toBeUndefined();

		expect(mockPrintOnboarding).toHaveBeenCalled();
		expect(mockRunSessionRepl).not.toHaveBeenCalled();
		expect(process.exitCode).toBeUndefined();
	});

	it("sets exitCode when session resolution fails", async () => {
		mockDefaultChatDeps.mockReturnValue({
			resolveSessionIdPrefix: vi
				.fn()
				.mockRejectedValue(new Error('Ambiguous session prefix "abc"')),
		});
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		await expect(
			runSessionLaunchFlow({ session: "abc" }),
		).resolves.toBeUndefined();

		expect(mockRunSessionRepl).not.toHaveBeenCalled();
		expect(stderrSpy).toHaveBeenCalledWith(
			expect.stringContaining('Ambiguous session prefix "abc"'),
		);
		expect(process.exitCode).toBe(1);
		stderrSpy.mockRestore();
	});
});
