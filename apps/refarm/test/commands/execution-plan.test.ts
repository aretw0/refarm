import { describe, expect, it } from "vitest";
import {
	createExecutionPlanHandoff,
	formatExecutionPlanReadinessLine,
} from "../../src/commands/execution-plan.js";

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
					blockedReason: "Provide a branch name with --name before executing tree fork.",
					recommendedCommand: null,
					commandTemplate:
						"refarm tree fork --scope git abc123 --name <branch-name>",
				}),
			).toEqual({
				nextAction: "Provide a branch name with --name before executing tree fork.",
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
						useWhen: "Provide a branch name with --name before executing tree fork.",
					},
			],
		});
	});
});
