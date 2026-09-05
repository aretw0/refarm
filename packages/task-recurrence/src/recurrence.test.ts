import { describe, expect, it } from "vitest";

import { expandRecurringTask, expandTemplate, resolveScheduleRef } from "./recurrence.js";

/** A fixed, locally-constructed reference date so weekday/month-day math is deterministic across
 * timezones (constructed via the local-time constructor, read via local getters). */
const NOW = new Date(2026, 6, 27, 9, 30, 0); // 2026-07-27, local time
const isoWeekday = (d: Date) => (d.getDay() + 6) % 7; // 0=Mon … 6=Sun

describe("task-recurrence — schedule reference resolution", () => {
	it("today / undefined resolves to now", () => {
		expect(resolveScheduleRef("today", NOW).getTime()).toBe(NOW.getTime());
		expect(resolveScheduleRef(undefined, NOW).getTime()).toBe(NOW.getTime());
	});

	it("next-weekday:N lands on weekday N, strictly in the future, within 7 days", () => {
		for (let n = 0; n <= 6; n++) {
			const d = resolveScheduleRef(`next-weekday:${n}`, NOW);
			expect(isoWeekday(d)).toBe(n);
			const days = Math.round((d.getTime() - NOW.getTime()) / 86_400_000);
			expect(days).toBeGreaterThanOrEqual(1);
			expect(days).toBeLessThanOrEqual(7);
		}
	});

	it("next-weekday for today's own weekday jumps a full week (matches the source semantics)", () => {
		const todayN = isoWeekday(NOW);
		const d = resolveScheduleRef(`next-weekday:${todayN}`, NOW);
		expect(Math.round((d.getTime() - NOW.getTime()) / 86_400_000)).toBe(7);
	});

	it("month-day:N lands on day N of the current month, time zeroed", () => {
		const d = resolveScheduleRef("month-day:5", NOW);
		expect(d.getDate()).toBe(5);
		expect(d.getMonth()).toBe(NOW.getMonth());
		expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
	});

	it("rejects malformed schedule tokens", () => {
		expect(() => resolveScheduleRef("next-weekday:9", NOW)).toThrow();
		expect(() => resolveScheduleRef("month-day:0", NOW)).toThrow();
		expect(() => resolveScheduleRef("someday", NOW)).toThrow();
	});
});

describe("task-recurrence — template expansion", () => {
	it("substitutes known keys and leaves unknown placeholders intact", () => {
		expect(expandTemplate("Run {date} → {deadline}", { date: "2026-07-27", deadline: "2026-07-30" })).toBe(
			"Run 2026-07-27 → 2026-07-30",
		);
		expect(expandTemplate("keep {unknown}", {})).toBe("keep {unknown}");
	});
});

describe("task-recurrence — expandRecurringTask → task:v1 create-input", () => {
	it("templates the title and derives due_at_ns from the deadline", () => {
		const deadline = new Date(2026, 6, 31, 0, 0, 0);
		const input = expandRecurringTask(
			{
				titleTemplate: "Weekly review — {date} (due {deadline})",
				schedule: "month-day:5",
				assignedTo: "me",
				tags: ["routine"],
			},
			{ now: NOW, deadline },
		);

		expect(input["@type"]).toBe("Task");
		expect(input.status).toBe("pending");
		expect(input.assigned_to).toBe("me");
		expect(input.parent_task_id).toBeNull();
		expect(input.tags).toEqual(["routine"]);
		expect(input.title).toContain("2026-07-05"); // month-day:5 → the 5th
		expect(input.title).toContain("2026-07-31"); // deadline
		expect(input.due_at_ns).toBe(deadline.getTime() * 1_000_000);
	});

	it("without a deadline, the due date is the resolved schedule date", () => {
		const input = expandRecurringTask({ titleTemplate: "Ping {date}" }, { now: NOW });
		expect(input.due_at_ns).toBe(NOW.getTime() * 1_000_000);
		expect(input.title).toBe(`Ping ${NOW.toISOString().slice(0, 10)}`);
		expect(input.assigned_to).toBeNull();
	});
});
