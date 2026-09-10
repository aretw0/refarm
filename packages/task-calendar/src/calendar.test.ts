import { describe, expect, it } from "vitest";

import {
	calendarEventToTask,
	expandCalendarTasks,
	parseICalDuration,
	parseICalendar,
} from "./calendar.js";

/** A synthetic .ics with a folded DESCRIPTION line, a timed event with DURATION, an all-day event,
 * and a UTC event with DTEND. */
const ICS = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"BEGIN:VEVENT",
	"UID:evt-1",
	"SUMMARY:Reunião semanal",
	"DESCRIPTION:Primeira linha\\, com vírgula",
	" e continuação dobrada",
	"LOCATION:Teams",
	"DTSTART;TZID=America/Sao_Paulo:20260728T140000",
	"DURATION:PT1H30M",
	"END:VEVENT",
	"BEGIN:VEVENT",
	"UID:evt-2",
	"SUMMARY:Feriado",
	"DTSTART;VALUE=DATE:20260901",
	"END:VEVENT",
	"BEGIN:VEVENT",
	"UID:evt-3",
	"SUMMARY:Deploy",
	"DTSTART:20260730T120000Z",
	"DTEND:20260730T130000Z",
	"END:VEVENT",
	"END:VCALENDAR",
].join("\r\n");

describe("task-calendar — iCalendar parsing", () => {
	it("parses VEVENTs, unfolds lines, unescapes text, resolves DURATION and all-day", () => {
		const events = parseICalendar(ICS);
		expect(events).toHaveLength(3);

		const [reuniao, feriado, deploy] = events;
		expect(reuniao?.summary).toBe("Reunião semanal");
		// folded continuation joined + escaped comma unescaped
		expect(reuniao?.description).toBe("Primeira linha, com vírgulae continuação dobrada");
		expect(reuniao?.location).toBe("Teams");
		expect(reuniao?.allDay).toBe(false);
		// start + PT1H30M → end 90 min later
		expect(reuniao?.end && reuniao.end.getTime() - reuniao.start.getTime()).toBe(90 * 60_000);

		expect(feriado?.allDay).toBe(true);
		expect(feriado?.start.getDate()).toBe(1);

		// UTC event: DTEND - DTSTART = 1h
		expect(deploy?.end && deploy.end.getTime() - deploy.start.getTime()).toBe(3_600_000);
	});

	it("parses iCalendar DURATION magnitudes", () => {
		expect(parseICalDuration("PT1H30M")).toBe(90 * 60_000);
		expect(parseICalDuration("P1D")).toBe(86_400_000);
		expect(parseICalDuration("P1W")).toBe(604_800_000);
		expect(parseICalDuration("")).toBe(0);
	});
});

describe("task-calendar — event → task:v1", () => {
	it("maps an event to a task:v1 create-input with a templated title and due_at_ns from start", () => {
		const [reuniao] = parseICalendar(ICS);
		const task = calendarEventToTask(reuniao!, {
			titleTemplate: "{summary} @ {location} — {date}",
			assignedTo: "me",
			tags: ["meeting"],
		});
		expect(task["@type"]).toBe("Task");
		expect(task.status).toBe("pending");
		expect(task.assigned_to).toBe("me");
		expect(task.tags).toEqual(["meeting"]);
		expect(task.title).toContain("Reunião semanal @ Teams");
		expect(task.due_at_ns).toBe(reuniao!.start.getTime() * 1_000_000);
	});

	it("expandCalendarTasks can keep only future events", () => {
		const all = expandCalendarTasks(ICS);
		expect(all).toHaveLength(3);

		const future = expandCalendarTasks(ICS, { now: new Date("2026-08-15T00:00:00Z"), futureOnly: true });
		// only the 2026-09-01 holiday remains after 2026-08-15
		expect(future).toHaveLength(1);
		expect(future[0]?.title).toBe("Feriado");
	});
});
