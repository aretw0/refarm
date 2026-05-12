import { describe, expect, it } from "vitest";
import { formatExecutionPlanReadinessLine } from "../../src/commands/execution-plan.js";

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
