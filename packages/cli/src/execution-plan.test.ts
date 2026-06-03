import { describe, expect, it } from "vitest";
import {
	createExecutionPlanHandoff,
	formatExecutionPlanReadinessLine,
	type ExecutionPlanBase,
	type ExecutionPlanHandoff,
	type ExecutionPlanHandoffInput,
	type ExecutionPlanReadinessInput,
	type ExecutionPlanReadinessLine,
	type RefarmExecutionPlanBase,
	type RefarmExecutionPlanHandoff,
	type RefarmExecutionPlanHandoffInput,
	type RefarmExecutionPlanReadinessInput,
	type RefarmExecutionPlanReadinessLine,
} from "./execution-plan.js";

type AssertSameType<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends
	(<Value>() => Value extends Right ? 1 : 2) ? true : never;

const _refarmExecutionPlanBaseAlias: AssertSameType<
	RefarmExecutionPlanBase<"run", Record<string, unknown>, { kind: "test" }>,
	ExecutionPlanBase<"run", Record<string, unknown>, { kind: "test" }>
> = true;
const _refarmExecutionPlanReadinessInputAlias: AssertSameType<
	RefarmExecutionPlanReadinessInput,
	ExecutionPlanReadinessInput
> = true;
const _refarmExecutionPlanReadinessLineAlias: AssertSameType<
	RefarmExecutionPlanReadinessLine,
	ExecutionPlanReadinessLine
> = true;
const _refarmExecutionPlanHandoffAlias: AssertSameType<
	RefarmExecutionPlanHandoff,
	ExecutionPlanHandoff
> = true;
const _refarmExecutionPlanHandoffInputAlias: AssertSameType<
	RefarmExecutionPlanHandoffInput,
	ExecutionPlanHandoffInput
> = true;

void [
	_refarmExecutionPlanBaseAlias,
	_refarmExecutionPlanReadinessInputAlias,
	_refarmExecutionPlanReadinessLineAlias,
	_refarmExecutionPlanHandoffAlias,
	_refarmExecutionPlanHandoffInputAlias,
];

describe("execution plan readiness", () => {
	it("formats blocked plans with their deterministic reason", () => {
		expect(
			formatExecutionPlanReadinessLine({
				readyToExecute: false,
				blockedReason:
					"Git worktree must be clean before tree switch execution.",
			}),
		).toEqual({
			status: "blocked",
			label:
				"Blocked: Git worktree must be clean before tree switch execution.",
		});
	});

	it("formats ready and not-ready plans without substrate-specific knowledge", () => {
		expect(formatExecutionPlanReadinessLine({ readyToExecute: true })).toEqual({
			status: "ready",
			label: "Ready: yes",
		});
		expect(formatExecutionPlanReadinessLine({ readyToExecute: false })).toEqual(
			{ status: "ready", label: "Ready: no" },
		);
	});
});

describe("execution plan handoffs", () => {
	it("exposes executable commands only when the plan is ready", () => {
		expect(
			createExecutionPlanHandoff({
				readyToExecute: true,
				recommendedCommand: "refarm tree switch abc123",
			}),
		).toEqual({
			nextAction: "refarm tree switch abc123",
			nextActions: ["refarm tree switch abc123"],
			nextCommand: "refarm tree switch abc123",
			nextCommands: ["refarm tree switch abc123"],
			templates: [],
		});
	});

	it("keeps blocked plans as operator actions instead of executable commands", () => {
		expect(
			createExecutionPlanHandoff({
				readyToExecute: false,
				blockedReason:
					"Provide a branch name with --name before executing tree fork.",
				recommendedCommand: null,
				commandTemplate:
					"refarm tree fork --scope git abc123 --name <branch-name>",
				processTemplate: {
					command: "refarm",
					args: [
						"tree",
						"fork",
						"--scope",
						"git",
						"abc123",
						"--name",
						"<branch-name>",
					],
					display: "refarm tree fork --scope git abc123 --name <branch-name>",
				},
			}),
		).toEqual({
			nextAction:
				"Provide a branch name with --name before executing tree fork.",
			nextActions: [
				"Provide a branch name with --name before executing tree fork.",
			],
			nextCommand: null,
			nextCommands: [],
			templates: [
				{
					id: "execution-plan-command",
					command: "refarm tree fork --scope git abc123 --name <branch-name>",
					parameters: ["branch-name"],
					process: {
						command: "refarm",
						args: [
							"tree",
							"fork",
							"--scope",
							"git",
							"abc123",
							"--name",
							"<branch-name>",
						],
						display: "refarm tree fork --scope git abc123 --name <branch-name>",
					},
					useWhen:
						"Provide a branch name with --name before executing tree fork.",
				},
			],
		});
	});
});
