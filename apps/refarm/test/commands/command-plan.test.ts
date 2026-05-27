import { describe, expect, it, vi } from "vitest";
import {
	buildCommandPlanEnvelope,
	buildCommandPlanRunEnvelope,
	commandPlanEffects,
	commandPlanStepCommands,
	commandPlanStepSummary,
	commandPlanWrites,
	runCommandPlan,
	type CommandPlanStep,
} from "../../src/commands/command-plan.js";

const steps: CommandPlanStep[] = [
	{
		id: "first",
		command: "refarm first --json",
		args: ["first", "--json"],
		description: "First step.",
		effect: "verify",
	},
	{
		id: "second",
		command: "refarm second --json",
		args: ["second", "--json"],
		description: "Second step.",
		effect: "observe",
	},
];

describe("command plan runner", () => {
	it("builds plan command lists and JSON envelopes", () => {
		expect(commandPlanStepCommands(steps)).toEqual([
			"refarm first --json",
			"refarm second --json",
		]);
		expect(commandPlanEffects(steps)).toEqual(["verify", "observe"]);
		expect(commandPlanWrites(steps)).toBe(false);
		expect(buildCommandPlanEnvelope({
			action: "finish",
			command: "agent",
			operation: "finish",
		}, steps)).toMatchObject({
			action: "finish",
			status: "plan",
			command: "agent",
			operation: "finish",
			ok: true,
			effects: ["verify", "observe"],
			writes: false,
			nextAction: "refarm first --json",
			nextCommand: "refarm first --json",
			nextCommands: ["refarm first --json", "refarm second --json"],
			steps: [
				expect.objectContaining({ id: "first", effect: "verify" }),
				expect.objectContaining({ id: "second", effect: "observe" }),
			],
		});
	});

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
			failedStepId: null,
			failedCommand: null,
			remainingSteps: [],
			remainingCommands: [],
			nextActions: [],
			nextCommands: [],
			steps: [{ id: "first", ok: true }, { id: "second", ok: true }],
		});
		expect(runStep).toHaveBeenCalledTimes(2);
	});

	it("builds run JSON envelopes from command plan results", () => {
		const result = runCommandPlan([steps[0]!], (step) => ({
			...step,
			ok: false,
			exitCode: 1,
			stdout: JSON.stringify({
				ok: false,
				nextCommand: "refarm runtime start --wait",
				recommendations: [{ diagnostic: "runtime:not-ready" }],
			}),
			stderr: "",
			payload: {
				ok: false,
				nextCommand: "refarm runtime start --wait",
				recommendations: [{ diagnostic: "runtime:not-ready" }],
			},
		}));

		expect(buildCommandPlanRunEnvelope({
			action: "finish",
			command: "agent",
			operation: "finish",
		}, result)).toMatchObject({
			action: "finish",
			status: "failed",
			command: "agent",
			operation: "finish",
			ok: false,
			effects: ["verify"],
			writes: false,
			failedStepId: "first",
			failedCommand: "refarm first --json",
			remainingCommands: [],
			nextAction: "refarm runtime start --wait",
			nextCommand: "refarm runtime start --wait",
			nextCommands: ["refarm runtime start --wait"],
			recommendations: [{ diagnostic: "runtime:not-ready" }],
			stepResults: [
				{
					id: "first",
					command: "refarm first --json",
					description: "First step.",
					ok: false,
					exitCode: 1,
					effect: "verify",
					payload: {
						ok: false,
						nextCommand: "refarm runtime start --wait",
						recommendations: [{ diagnostic: "runtime:not-ready" }],
					},
				},
			],
			steps: [{ id: "first", ok: false }],
		});
	});

	it("summarizes command plan step results without raw streams", () => {
		expect(commandPlanStepSummary({
			...steps[0]!,
			ok: false,
			exitCode: 1,
			stdout: "large stdout",
			stderr: "large stderr",
			payload: {
				ok: false,
				nextCommand: "refarm runtime start --wait",
				stdout: "nested stdout",
				stderr: "nested stderr",
				nested: {
					stdout: "nested child stdout",
					stderr: "nested child stderr",
					nextCommand: "refarm doctor --next-command",
				},
				results: [
					{
						stdout: "array stdout",
						stderr: "array stderr",
						ok: false,
					},
				],
			},
		})).toEqual({
			id: "first",
			command: "refarm first --json",
			description: "First step.",
			ok: false,
			exitCode: 1,
			effect: "verify",
			payload: {
				ok: false,
				nextCommand: "refarm runtime start --wait",
				nested: {
					nextCommand: "refarm doctor --next-command",
				},
				results: [
					{
						ok: false,
					},
				],
			},
		});
	});

	it("keeps process metadata in command plan step summaries", () => {
		expect(commandPlanStepSummary({
			...steps[0]!,
			ok: true,
			exitCode: 0,
			stdout: "",
			stderr: "",
			process: {
				command: "npm",
				args: ["--prefix", "apps/refarm", "run", "type-check"],
				cwd: "/workspaces/refarm",
				display: "npm --prefix apps/refarm run type-check",
				packageManager: "npm",
			},
		})).toEqual({
			id: "first",
			command: "refarm first --json",
			description: "First step.",
			ok: true,
			exitCode: 0,
			effect: "verify",
			process: {
				command: "npm",
				args: ["--prefix", "apps/refarm", "run", "type-check"],
				cwd: "/workspaces/refarm",
				display: "npm --prefix apps/refarm run type-check",
				packageManager: "npm",
			},
		});
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
					nextActions: [" Repair runtime. ", "Repair runtime.", ""],
					nextCommands: [
						" refarm runtime start --wait ",
						"refarm runtime start --wait",
						"  ",
					],
				}),
				stderr: "",
				payload: {
					ok: false,
					nextActions: [" Repair runtime. ", "Repair runtime.", ""],
					nextCommands: [
						" refarm runtime start --wait ",
						"refarm runtime start --wait",
						"  ",
					],
				},
			}));

		expect(runCommandPlan(steps, runStep)).toMatchObject({
			ok: false,
			status: "failed",
			failedStepId: "second",
			failedCommand: "refarm second --json",
			remainingSteps: [],
			remainingCommands: [],
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
			failedStepId: "first",
			failedCommand: "refarm first --json",
			remainingCommands: ["refarm second --json"],
			nextActions: ["refarm first --json"],
			nextCommands: ["refarm first --json"],
			steps: [{ id: "first", ok: false }],
		});
		expect(runStep).toHaveBeenCalledTimes(1);
	});

	it("forwards singular payload handoffs from failing steps", () => {
		const runStep = vi.fn((step: CommandPlanStep) => ({
			...step,
			ok: false,
			exitCode: 1,
			stdout: JSON.stringify({
				ok: false,
				nextAction: "Start runtime.",
				nextCommand: "refarm runtime start --wait",
			}),
			stderr: "",
			payload: {
				ok: false,
				nextAction: "Start runtime.",
				nextCommand: "refarm runtime start --wait",
				recommendations: [
					{
						diagnostic: "runtime:not-ready",
						command: "refarm runtime start --wait",
					},
				],
			},
		}));

		expect(runCommandPlan(steps, runStep)).toMatchObject({
			ok: false,
			status: "failed",
			failedStepId: "first",
			failedCommand: "refarm first --json",
			remainingCommands: ["refarm second --json"],
			nextActions: ["Start runtime."],
			nextCommands: ["refarm runtime start --wait"],
			recommendations: [
				{
					diagnostic: "runtime:not-ready",
					command: "refarm runtime start --wait",
				},
			],
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
			effect: "write" as const,
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
			effect: "verify",
			ok: true,
		});
	});
});
