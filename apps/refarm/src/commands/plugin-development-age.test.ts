import { describe, expect, it } from "vitest";

import {
	DEVELOPMENT_STALE_AFTER_DAYS,
	developmentAgeDays,
	readPluginsUnderDevelopment,
	stalePluginDevelopment,
} from "./plugin-development-age.js";

const NOW = new Date("2026-08-28T12:00:00Z");

function config(entries: Record<string, { declaredAt?: string }>) {
	return { pluginDevelopment: entries };
}

describe("developmentAgeDays", () => {
	it("counts whole days", () => {
		expect(developmentAgeDays("2026-08-18T12:00:00Z", NOW)).toBe(10);
	});

	it("reads an unparseable stamp as unknown, never as zero", () => {
		// ZERO WOULD BE A LIE that reads as "declared today" — the freshest possible state, from
		// the least trustworthy input.
		expect(developmentAgeDays("not-a-date", NOW)).toBeNull();
	});

	it("never reports a negative age", () => {
		// A stamp in the future is a fact about a clock. "-3 days under development" would send
		// the reader after the wrong thing.
		expect(developmentAgeDays("2026-09-01T00:00:00Z", NOW)).toBe(0);
	});
});

describe("readPluginsUnderDevelopment", () => {
	it("reports each declaration with its age, oldest first", () => {
		const entries = readPluginsUnderDevelopment(
			config({
				fresh: { declaredAt: "2026-08-27T12:00:00Z" },
				ancient: { declaredAt: "2026-06-28T12:00:00Z" },
			}),
			NOW,
		);
		expect(entries.map((entry) => entry.pluginId)).toEqual(["ancient", "fresh"]);
		expect(entries[0]?.ageDays).toBe(61);
		expect(entries[1]?.ageDays).toBe(1);
	});

	it("reports nothing when the config cannot be read, matching the enforcement path", () => {
		// The loader treats a malformed declaration as ABSENT, so a reporter that disagreed would
		// describe a node that does not exist.
		expect(readPluginsUnderDevelopment(null, NOW)).toEqual([]);
		expect(readPluginsUnderDevelopment({ pluginDevelopment: "nonsense" }, NOW)).toEqual([]);
	});

	it("ignores a declaration with no timestamp, as the loader does", () => {
		expect(readPluginsUnderDevelopment(config({ nostamp: {} }), NOW)).toEqual([]);
	});
});

describe("stalePluginDevelopment", () => {
	it("selects the ones old enough to revisit", () => {
		const entries = readPluginsUnderDevelopment(
			config({
				old: { declaredAt: "2026-06-28T12:00:00Z" },
				recent: { declaredAt: "2026-08-27T12:00:00Z" },
			}),
			NOW,
		);
		expect(stalePluginDevelopment(entries).map((entry) => entry.pluginId)).toEqual(["old"]);
		expect(DEVELOPMENT_STALE_AFTER_DAYS).toBe(30);
	});

	it("never calls an unreadable stamp stale", () => {
		// It is a DIFFERENT finding — "this declaration has no usable date" — and folding it into
		// staleness would hide it behind an action that does not fit.
		const entries = [{ pluginId: "x", declaredAt: "nope", ageDays: null }];
		expect(stalePluginDevelopment(entries)).toEqual([]);
	});
});
