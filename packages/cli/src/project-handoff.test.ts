import { describe, expect, it } from "vitest";
import {
	buildProjectHandoffDocument,
	parseProjectHandoffSummary,
	validateProjectHandoffDocument,
} from "./project-handoff.js";

describe("project handoff", () => {
	it("parses the resume summary shape from project handoff JSON", () => {
		expect(
			parseProjectHandoffSummary(
				{
					context: "current work",
					timestamp: "2026-06-27T06:00:00.000Z",
					current_phase: 12,
					current_tasks: ["task A", "task B", "task C"],
					blockers: ["blocked"],
					next_actions: ["next"],
					open_questions: ["question"],
				},
				{ arrayLimit: 2 },
			),
		).toEqual({
			path: ".project/handoff.json",
			context: "current work",
			timestamp: "2026-06-27T06:00:00.000Z",
			currentPhase: 12,
			currentTasks: ["task A", "task B"],
			blockers: ["blocked"],
			nextActions: ["next"],
			openQuestions: ["question"],
			truncation: {
				currentTasks: { returned: 2, total: 3 },
				blockers: { returned: 1, total: 1 },
				nextActions: { returned: 1, total: 1 },
				openQuestions: { returned: 1, total: 1 },
			},
		});
	});

	it("validates required fields and array item types", () => {
		const result = validateProjectHandoffDocument({
			context: "",
			timestamp: "not-a-date",
			current_phase: {},
			current_tasks: ["ok", ""],
			blockers: "blocked",
		});

		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.code)).toEqual([
			"context_required",
			"timestamp_invalid",
			"current_phase_invalid",
			"array_item_invalid",
			"array_invalid",
		]);
	});

	it("reports stale handoffs as warnings without failing validation", () => {
		const result = validateProjectHandoffDocument(
			{
				context: "old but parseable",
				timestamp: "2026-06-01T00:00:00.000Z",
			},
			{
				now: new Date("2026-06-27T00:00:00.000Z"),
				maxAgeMs: 7 * 24 * 60 * 60 * 1000,
			},
		);

		expect(result.ok).toBe(true);
		expect(result.stale).toBe(true);
		expect(result.issues).toMatchObject([{ code: "timestamp_stale", severity: "warning" }]);
	});

	it("builds explicit checkpoint updates while preserving unknown fields", () => {
		const document = buildProjectHandoffDocument(
			{
				context: "before",
				timestamp: "2026-06-01T00:00:00.000Z",
				key_decisions_active: ["DEC-1"],
			},
			{
				context: "after",
				currentPhase: 12,
				nextActions: ["ship write command"],
			},
			{
				now: new Date("2026-06-27T06:00:00.000Z"),
			},
		);

		expect(document).toMatchObject({
			context: "after",
			timestamp: "2026-06-27T06:00:00.000Z",
			current_phase: 12,
			next_actions: ["ship write command"],
			key_decisions_active: ["DEC-1"],
		});
	});
});

describe("parseProjectHandoffSummary truncation", () => {
	const base = { context: "c", timestamp: "2026-08-08T00:00:00Z", current_phase: "14" };

	it("reports the total when the limit cuts the list", () => {
		const summary = parseProjectHandoffSummary(
			{ ...base, next_actions: ["a", "b", "c", "d", "e", "f", "g"] },
			{ arrayLimit: 5 },
		);
		expect(summary?.nextActions).toHaveLength(5);
		expect(summary?.truncation.nextActions).toEqual({ returned: 5, total: 7 });
	});

	it("does not claim truncation at exactly the limit", () => {
		const summary = parseProjectHandoffSummary(
			{ ...base, next_actions: ["a", "b", "c", "d", "e"] },
			{ arrayLimit: 5 },
		);
		expect(summary?.truncation.nextActions).toEqual({ returned: 5, total: 5 });
	});

	it("counts the total before blanks are dropped, not after", () => {
		const summary = parseProjectHandoffSummary(
			{ ...base, blockers: ["a", "   ", "b"] },
			{ arrayLimit: 5 },
		);
		expect(summary?.blockers).toEqual(["a", "b"]);
		expect(summary?.truncation.blockers).toEqual({ returned: 2, total: 2 });
	});

	it("reports every field, including the ones that were not cut", () => {
		const summary = parseProjectHandoffSummary({ ...base }, { arrayLimit: 5 });
		expect(summary?.truncation).toEqual({
			currentTasks: { returned: 0, total: 0 },
			blockers: { returned: 0, total: 0 },
			nextActions: { returned: 0, total: 0 },
			openQuestions: { returned: 0, total: 0 },
		});
	});

	it("reports no truncation when no limit is given", () => {
		const summary = parseProjectHandoffSummary(
			{ ...base, next_actions: ["a", "b", "c", "d", "e", "f"] },
			{},
		);
		expect(summary?.nextActions).toHaveLength(6);
		expect(summary?.truncation.nextActions).toEqual({ returned: 6, total: 6 });
	});
});
