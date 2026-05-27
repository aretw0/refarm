import { describe, expect, it, vi } from "vitest";
import {
	buildCommandPlanEnvelope,
	buildCommandPlanRunEnvelope,
	commandPlanEffects,
	commandPlanStepCommands,
	commandPlanStepSummary,
	commandPlanWrites,
	runCommandPlanCliStep,
	runCommandPlan,
	runCommandPlanProcessStep,
	type CommandPlanStep,
} from "./command-plan.js";

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
	});

	it("builds run JSON envelopes and strips raw streams from summaries", () => {
		const result = runCommandPlan([steps[0]!], (step) => ({
			...step,
			ok: false,
			exitCode: 1,
			stdout: "large stdout",
			stderr: "large stderr",
			payload: {
				ok: false,
				nextCommand: "refarm runtime start --wait",
				recommendations: [{ diagnostic: "runtime:not-ready" }],
				stdout: "nested stdout",
				stderr: "nested stderr",
			},
		}));

		expect(buildCommandPlanRunEnvelope({
			action: "finish",
			command: "agent",
			operation: "finish",
		}, result)).toMatchObject({
			action: "finish",
			status: "failed",
			ok: false,
			nextCommand: "refarm runtime start --wait",
			recommendations: [{ diagnostic: "runtime:not-ready" }],
			stepResults: [
				{
					id: "first",
					payload: {
						ok: false,
						nextCommand: "refarm runtime start --wait",
						recommendations: [{ diagnostic: "runtime:not-ready" }],
					},
				},
			],
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
		})).toMatchObject({
			id: "first",
			process: {
				command: "npm",
				args: ["--prefix", "apps/refarm", "run", "type-check"],
				cwd: "/workspaces/refarm",
				display: "npm --prefix apps/refarm run type-check",
				packageManager: "npm",
			},
		});
	});

	it("runs CLI steps and parses JSON payloads from stdout", () => {
		expect(
			runCommandPlanCliStep(
				[
					"console.log('prefix'); console.log(JSON.stringify({ ok: true, nextCommand: 'refarm next' }));",
				],
				{
					executable: process.execPath,
					entrypoint: "-e",
					command: "node -e <script>",
				},
			),
		).toMatchObject({
			ok: true,
			exitCode: 0,
			command: "node -e <script>",
			payload: {
				ok: true,
				nextCommand: "refarm next",
			},
		});
	});

	it("uses an executable argv display when CLI step command is not provided", () => {
		expect(
			runCommandPlanCliStep(["process.exit(0);"], {
				executable: process.execPath,
				entrypoint: "-e",
			}).command,
		).toContain("'-e' 'process.exit(0);'");
	});

	it("runs process steps from process metadata", () => {
		expect(
			runCommandPlanProcessStep({
				id: "process",
				command: "node -e <script>",
				args: [],
				description: "Run process.",
				process: {
					command: process.execPath,
					args: ["-e", "process.stdout.write('ok'); process.exit(3);"],
					display: "node -e <script>",
				},
			}),
		).toMatchObject({
			id: "process",
			ok: false,
			exitCode: 3,
			stdout: "ok",
			stderr: "",
		});
	});
});
