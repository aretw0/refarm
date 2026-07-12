import type { ProcessActivity } from "@refarm.dev/capabilities";
import { describe, expect, it } from "vitest";

import {
	liveActivitiesFromEvents,
	renderActivityPill,
	renderActivityPills,
} from "./activity-web.js";

const started = (activityRef: string, label: string, kind = "agent"): ProcessActivity => ({
	activityRef,
	phase: "started",
	label,
	kind,
});
const finished = (activityRef: string, label: string, kind = "agent"): ProcessActivity => ({
	activityRef,
	phase: "finished",
	label,
	kind,
	ok: true,
});

describe("liveActivitiesFromEvents", () => {
	it("keeps started-but-not-finished activities, most-recent last", () => {
		const live = liveActivitiesFromEvents([
			started("a", "Agent responding"),
			started("b", "Cloning repo", "git"),
		]);
		expect(live.map((l) => l.activityRef)).toEqual(["a", "b"]);
	});

	it("drops an activity once it finishes", () => {
		const live = liveActivitiesFromEvents([
			started("a", "Agent responding"),
			finished("a", "Agent responding"),
		]);
		expect(live).toHaveLength(0);
	});

	it("carries the latest progress note onto the live activity", () => {
		const live = liveActivitiesFromEvents([
			started("a", "Sowing", "auth"),
			{ activityRef: "a", phase: "progress", label: "Sowing", kind: "auth", note: "verifying GitHub access" },
		]);
		expect(live[0]?.note).toBe("verifying GitHub access");
	});
});

describe("renderActivityPill", () => {
	it("renders a working pill with the label, kind, and 🟢 tone", () => {
		const html = renderActivityPill({ activityRef: "a", label: "Agent responding", kind: "agent" });
		expect(html).toContain("🟢");
		expect(html).toContain("Agent responding");
		expect(html).toContain('data-activity-kind="agent"');
		expect(html).toContain('data-activity-ref="a"');
		expect(html).toContain("working…");
	});

	it("shows the progress note as the status when present", () => {
		const html = renderActivityPill({
			activityRef: "a",
			label: "Sowing",
			kind: "auth",
			note: "verifying GitHub access",
		});
		expect(html).toContain("verifying GitHub access");
		expect(html).not.toContain("working…");
	});

	it("escapes HTML in the label and note (no injection)", () => {
		const html = renderActivityPill({
			activityRef: "a",
			label: "<script>alert(1)</script>",
			kind: "agent",
			note: "a & b",
		});
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("a &amp; b");
	});
});

describe("renderActivityPills", () => {
	it("renders a pill per live activity", () => {
		const html = renderActivityPills([
			started("a", "Agent responding"),
			started("b", "Cloning repo", "git"),
		]);
		expect(html).toContain("Agent responding");
		expect(html).toContain("Cloning repo");
		expect((html.match(/refarm-pill-activity/g) ?? []).length).toBe(2);
	});

	it("is empty when nothing is running (idle surface shows nothing)", () => {
		expect(renderActivityPills([started("a", "x"), finished("a", "x")])).toBe("");
		expect(renderActivityPills([])).toBe("");
	});
});
