import type {
	EffortResult,
	EffortTransportAdapter,
} from "@refarm.dev/effort-contract-v1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskCommand } from "../../src/commands/task.js";

describe("refarm task run", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("dispatches effort and prints effortId", async () => {
		const adapter: EffortTransportAdapter = {
			submit: vi.fn().mockResolvedValue("effort-abc"),
			query: vi.fn(),
		};

		const taskCommand = createTaskCommand(() => adapter);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "run")!
			.parseAsync(["my-plugin", "process", "--direction", "Test effort"], {
				from: "user",
			});

		expect(adapter.submit).toHaveBeenCalledWith(
			expect.objectContaining({
				direction: "Test effort",
				source: "refarm-cli",
			}),
		);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("effort-abc"));
		spy.mockRestore();
	});

	it("prints error and sets exitCode when --args is invalid JSON", async () => {
		const adapter: EffortTransportAdapter = {
			submit: vi.fn(),
			query: vi.fn(),
		};

		const taskCommand = createTaskCommand(() => adapter);
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "run")!
			.parseAsync(["p", "f", "--args", "not-json"], { from: "user" });

		expect(spy).toHaveBeenCalledWith(expect.stringContaining("valid JSON"));
		expect(adapter.submit).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		spy.mockRestore();
	});
});

describe("refarm task status", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("prints 'No result yet' when query returns null", async () => {
		const adapter: EffortTransportAdapter = {
			submit: vi.fn(),
			query: vi.fn().mockResolvedValue(null),
		};

		const taskCommand = createTaskCommand(() => adapter);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "status")!
			.parseAsync(["effort-abc"], { from: "user" });

		expect(spy).toHaveBeenCalledWith(expect.stringContaining("No result yet"));
		spy.mockRestore();
	});

	it("prints status and task results when found", async () => {
		const result: EffortResult = {
			effortId: "effort-abc",
			status: "done",
			results: [
				{
					taskId: "t1",
					effortId: "effort-abc",
					status: "ok",
					completedAt: new Date().toISOString(),
				},
			],
			completedAt: new Date().toISOString(),
		};
		const adapter: EffortTransportAdapter = {
			submit: vi.fn(),
			query: vi.fn().mockResolvedValue(result),
		};

		const taskCommand = createTaskCommand(() => adapter);
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await taskCommand.commands
			.find((command) => command.name() === "status")!
			.parseAsync(["effort-abc"], { from: "user" });

		expect(spy).toHaveBeenCalledWith(expect.stringContaining("done"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("t1"));
		spy.mockRestore();
	});
});
