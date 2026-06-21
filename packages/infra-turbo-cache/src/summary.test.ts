import { describe, expect, it } from "vitest";
import { parseTurboCacheRunSummary } from "./summary.js";

describe("parseTurboCacheRunSummary", () => {
	it("parses turbo task and cache counters", () => {
		expect(parseTurboCacheRunSummary([
			" Tasks:    38 successful, 38 total",
			"Cached:    34 cached, 38 total",
			"  Time:    16.984s",
		].join("\n"))).toEqual({
			tool: "turbo",
			cached: 34,
			total: 38,
			hitRate: 34 / 38,
			status: "partial-hit",
			tasksSuccessful: 38,
			tasksTotal: 38,
		});
	});

	it("classifies miss and full-hit runs", () => {
		expect(parseTurboCacheRunSummary("Cached:    0 cached, 38 total")).toMatchObject({
			cached: 0,
			total: 38,
			status: "miss",
		});
		expect(parseTurboCacheRunSummary("Cached:    38 cached, 38 total")).toMatchObject({
			cached: 38,
			total: 38,
			status: "full-hit",
		});
	});

	it("returns null when turbo output has no cache counters", () => {
		expect(parseTurboCacheRunSummary("No tasks were executed")).toBeNull();
	});
});
