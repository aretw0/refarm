import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAgentParseAsync, mockCheckParseAsync, mockProgramParseAsync } = vi.hoisted(() => ({
	mockAgentParseAsync: vi.fn().mockResolvedValue(undefined),
	mockCheckParseAsync: vi.fn().mockResolvedValue(undefined),
	mockProgramParseAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/commands/agent.js", () => ({
	agentCommand: {
		parseAsync: mockAgentParseAsync,
	},
}));

vi.mock("../src/commands/check.js", () => ({
	checkCommand: {
		parseAsync: mockCheckParseAsync,
	},
}));

vi.mock("../src/program.js", () => ({
	program: {
		parseAsync: mockProgramParseAsync,
	},
}));

describe("runCliMain", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("dispatches check through the fast path without loading the full program", async () => {
		const { runCliMain } = await import("../src/cli-main.js");

		await runCliMain(["node", "refarm", "check", "--next-action", "--json"]);

		expect(mockCheckParseAsync).toHaveBeenCalledWith(
			["--next-action", "--json"],
			{ from: "user" },
		);
		expect(mockProgramParseAsync).not.toHaveBeenCalled();
	});

	it("dispatches agent finish through the fast path without loading the full program", async () => {
		const { runCliMain } = await import("../src/cli-main.js");

		await runCliMain(["node", "refarm", "agent", "finish", "--profile", "quick", "--json"]);

		expect(mockAgentParseAsync).toHaveBeenCalledWith(
			["finish", "--profile", "quick", "--json"],
			{ from: "user" },
		);
		expect(mockProgramParseAsync).not.toHaveBeenCalled();
		expect(mockCheckParseAsync).not.toHaveBeenCalled();
	});

	it("falls back to the full program for other commands", async () => {
		const { runCliMain } = await import("../src/cli-main.js");
		const argv = ["node", "refarm", "status", "--json"];

		await runCliMain(argv);

		expect(mockProgramParseAsync).toHaveBeenCalledWith(argv);
		expect(mockCheckParseAsync).not.toHaveBeenCalled();
		expect(mockAgentParseAsync).not.toHaveBeenCalled();
	});
});
