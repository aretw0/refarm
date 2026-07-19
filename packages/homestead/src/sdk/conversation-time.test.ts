import { describe, expect, it } from "vitest";

import {
	conversationDayLabel,
	conversationMessageTime,
	groupConversationByDay,
} from "./conversation-time.js";

/** Build a LOCAL instant (ms) — both `now` and the messages are constructed this way, so the local
 * calendar-day math is consistent regardless of the runner's timezone. */
function at(year: number, month1: number, day: number, hour = 12, min = 0): number {
	return new Date(year, month1 - 1, day, hour, min).getTime();
}

const NOW = at(2026, 7, 18, 14, 30); // a Saturday, 2026-07-18 14:30 local

describe("conversationDayLabel — the messenger day-separator convention", () => {
	it("labels today and yesterday relatively (pt-BR default)", () => {
		expect(conversationDayLabel(at(2026, 7, 18, 9, 0), { now: NOW })).toBe("Hoje");
		expect(conversationDayLabel(at(2026, 7, 17, 23, 59), { now: NOW })).toBe("Ontem");
	});

	it("derives today/yesterday from the locale via Intl.RelativeTimeFormat, not a hard-coded pt-BR word", () => {
		// The whole point of the adopt: the today/yesterday words now honor `locale` like every other
		// branch does — the hand-rolled version returned pt-BR "Hoje"/"Ontem" even for `locale: "en"`.
		expect(conversationDayLabel(at(2026, 7, 18, 9, 0), { now: NOW, locale: "en" })).toBe("Today");
		expect(conversationDayLabel(at(2026, 7, 17, 23, 59), { now: NOW, locale: "en" })).toBe("Yesterday");
		expect(conversationDayLabel(at(2026, 7, 18, 9, 0), { now: NOW, locale: "es" })).toBe("Hoy");
		// Capitalized for a header (RelativeTimeFormat itself yields a lowercase word).
		expect(conversationDayLabel(at(2026, 7, 17, 9, 0), { now: NOW, locale: "fr" })).toBe("Hier");
	});

	it("labels 2–6 days ago with the weekday name", () => {
		const three = at(2026, 7, 15, 10, 0);
		const expected = new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(new Date(three));
		expect(conversationDayLabel(three, { now: NOW })).toBe(expected);
	});

	it("labels older-this-year with day + month, and prior years with the year too", () => {
		const older = at(2026, 3, 2, 10, 0);
		expect(conversationDayLabel(older, { now: NOW })).toBe(
			new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" }).format(new Date(older)),
		);
		const lastYear = at(2025, 12, 20, 10, 0);
		expect(conversationDayLabel(lastYear, { now: NOW })).toBe(
			new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(lastYear)),
		);
	});

	it("honors label overrides + locale", () => {
		expect(conversationDayLabel(NOW, { now: NOW, todayLabel: "Today" })).toBe("Today");
		expect(conversationDayLabel(at(2026, 7, 17), { now: NOW, yesterdayLabel: "Yesterday" })).toBe("Yesterday");
	});

	it("never reads a future instant as 'Hoje' (clock skew falls through to a date)", () => {
		const tomorrow = at(2026, 7, 19, 9, 0);
		expect(conversationDayLabel(tomorrow, { now: NOW })).not.toBe("Hoje");
	});
});

describe("conversationMessageTime", () => {
	it("formats HH:MM in the viewer's locale", () => {
		const t = at(2026, 7, 18, 9, 5);
		expect(conversationMessageTime(t)).toBe(
			new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(t)),
		);
	});
});

describe("groupConversationByDay", () => {
	it("returns [] for no messages", () => {
		expect(groupConversationByDay([], { now: NOW })).toEqual([]);
	});

	it("buckets consecutive same-day messages together and splits on the day change", () => {
		const messages = [
			{ at: at(2026, 7, 17, 8, 0), text: "a" }, // yesterday
			{ at: at(2026, 7, 17, 20, 0), text: "b" }, // yesterday
			{ at: at(2026, 7, 18, 9, 0), text: "c" }, // today
			{ at: at(2026, 7, 18, 14, 0), text: "d" }, // today
		];
		const groups = groupConversationByDay(messages, { now: NOW });
		expect(groups.map((g) => g.label)).toEqual(["Ontem", "Hoje"]);
		expect(groups.map((g) => g.messages.map((m) => m.text))).toEqual([
			["a", "b"],
			["c", "d"],
		]);
		expect(groups.map((g) => g.dayKey)).toEqual(["2026-07-17", "2026-07-18"]);
	});
});
