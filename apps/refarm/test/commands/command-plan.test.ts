import { describe, expect, it, vi } from "vitest";
import {
	runCommandPlan,
	type CommandPlanStep,
} from "../../src/commands/command-plan.js";

const steps: CommandPlanStep[] = [
	{
		id: "first",
		command: "refarm first --json",
		args: ["first", "--json"],
		description: "First step.",
	},
	{
		id: "second",
		command: "refarm second --json",
		args: ["second", "--json"],
		description: "Second step.",
	},
];

describe("command plan runner", () => {
	it("runs every step when all commands succeed", () => {
		const runStep = vi.fn((step: CommandPlanStep) => ({
			...step,
			ok: true,
			exitCode: 0,
			stdout: JSON.stringify({ ok: true }),
			stderr: "",
			payload: { ok: true },
		}));

		expect(runCommandPlan(steps, runStep)).toMatchObject({
			ok: true,
			status: "passed",
			nextActions: [],
			nextCommands: [],
			steps: [{ id: "first", ok: true }, { id: "second", ok: true }],
		});
		expect(runStep).toHaveBeenCalledTimes(2);
	});

	it("stops at the first failing step and forwards payload handoffs", () => {
		const runStep = vi
			.fn()
			.mockImplementationOnce((step: CommandPlanStep) => ({
				...step,
				ok: true,
				exitCode: 0,
				stdout: JSON.stringify({ ok: true }),
				stderr: "",
				payload: { ok: true },
			}))
			.mockImplementationOnce((step: CommandPlanStep) => ({
				...step,
				ok: false,
				exitCode: 1,
				stdout: JSON.stringify({
					ok: false,
					nextActions: ["Repair runtime."],
					nextCommands: ["refarm runtime start --wait"],
				}),
				stderr: "",
				payload: {
					ok: false,
					nextActions: ["Repair runtime."],
					nextCommands: ["refarm runtime start --wait"],
				},
			}));

		expect(runCommandPlan(steps, runStep)).toMatchObject({
			ok: false,
			status: "failed",
			nextActions: ["Repair runtime."],
			nextCommands: ["refarm runtime start --wait"],
			steps: [{ id: "first", ok: true }, { id: "second", ok: false }],
		});
		expect(runStep).toHaveBeenCalledTimes(2);
	});

	it("falls back to the failed step command when no payload handoff is available", () => {
		const runStep = vi.fn((step: CommandPlanStep) => ({
			...step,
			ok: false,
			exitCode: 2,
			stdout: "",
			stderr: "failed",
		}));

		expect(runCommandPlan(steps, runStep)).toMatchObject({
			ok: false,
			status: "failed",
			nextActions: ["refarm first --json"],
			nextCommands: ["refarm first --json"],
			steps: [{ id: "first", ok: false }],
		});
		expect(runStep).toHaveBeenCalledTimes(1);
	});

	it("preserves planned step identity over runner metadata", () => {
		const runStep = vi.fn((step: CommandPlanStep) => ({
			...step,
			id: "runner-id",
			command: "runner command",
			args: ["runner"],
			description: "Runner description.",
			ok: true,
			exitCode: 0,
			stdout: JSON.stringify({ ok: true }),
			stderr: "",
			payload: { ok: true },
		}));

		expect(runCommandPlan([steps[0]!], runStep).steps[0]).toMatchObject({
			id: "first",
			command: "refarm first --json",
			args: ["first", "--json"],
			description: "First step.",
			ok: true,
		});
	});
});
