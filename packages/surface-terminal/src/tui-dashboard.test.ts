import type { SurfaceModel } from "@refarm.dev/capabilities";
import { describe, expect, it } from "vitest";

import {
	dashboardColorsFromTuiTheme,
	defaultDashboardColors,
	renderCapabilityDashboard,
	runInteractiveDashboard,
	surfaceModelToLayout,
} from "./tui-dashboard.js";
import { scriptedInput } from "./tui-input.js";

const model: SurfaceModel = {
	sections: [
		{
			section: "citizen",
			items: [
				{ name: "wallet", summary: "Show wallet", section: "citizen", surfaces: { tui: {} } },
				{ name: "trust", summary: "Trust registry", section: "citizen", surfaces: { tui: {} } },
			],
		},
	],
};

describe("surfaceModelToLayout (surface model → flex card grid)", () => {
	it("maps sections to a column of heading + wrapping card row", () => {
		const layout = surfaceModelToLayout(model, { cardWidth: 20, gap: 1 });
		expect(layout.direction).toBe("column");
		expect(layout.children).toHaveLength(1); // one section

		const section = layout.children![0]!;
		expect(section.children![0]!.text).toBe("citizen"); // heading leaf

		const cardRow = section.children![1]!;
		expect(cardRow.direction).toBe("row");
		expect(cardRow.wrap).toBe(true);
		expect(cardRow.children).toHaveLength(2); // two cards

		const firstCard = cardRow.children![0]!;
		expect(firstCard.width).toBe(20);
		expect(firstCard.padding).toBe(1);
		expect(firstCard.children![0]!.text).toBe("wallet");
		expect(firstCard.children![1]!.text).toBe("Show wallet");
	});

	it("bakes injected colorizers into the card text (brand-neutral by default)", () => {
		const layout = surfaceModelToLayout(model, { colors: { name: (s) => `<${s}>` } });
		const firstCard = layout.children![0]!.children![1]!.children![0]!;
		expect(firstCard.children![0]!.text).toBe("<wallet>"); // name colorizer applied
		expect(firstCard.children![1]!.text).toBe("Show wallet"); // summary left plain (identity)
	});
});

describe("renderCapabilityDashboard (model → Yoga layout → ANSI)", () => {
	it("lays a section's cards side by side and shows names + summaries", async () => {
		const out = await renderCapabilityDashboard(model, { width: 80 });
		expect(out).toContain("citizen"); // section heading
		expect(out).toContain("Show wallet");
		expect(out).toContain("Trust registry");

		// The two cards are a COLUMN grid: the row that holds "wallet" also holds "trust".
		const lines = out.split("\n");
		const nameRow = lines.find((line) => line.includes("wallet"));
		expect(nameRow).toBeDefined();
		expect(nameRow).toContain("trust");
		// "trust" sits to the RIGHT of "wallet" (a second column, not stacked).
		expect(nameRow!.indexOf("trust")).toBeGreaterThan(nameRow!.indexOf("wallet"));
	});
});

describe("surfaceModelToLayout focusable cards", () => {
	it("marks each card focusable with its verb name as id", () => {
		const layout = surfaceModelToLayout(model);
		const cardRow = layout.children![0]!.children![1]!;
		expect(cardRow.children!.map((card) => card.id)).toEqual(["wallet", "trust"]);
		expect(cardRow.children!.every((card) => card.focusable === true)).toBe(true);
		expect(cardRow.children!.every((card) => card.border === true)).toBe(true);
	});
});

describe("runInteractiveDashboard (headless)", () => {
	it("navigates cards with arrows and dispatches the focused verb on Enter", async () => {
		const selected: string[] = [];
		const frames: string[] = [];
		const last = await runInteractiveDashboard(model, {
			width: 80,
			input: scriptedInput([{ name: "right" }, { name: "return" }, { name: "escape" }]),
			output: (frame) => frames.push(frame),
			onSelect: (verb) => {
				selected.push(verb);
			},
		});
		// initial focus = wallet (first card) → right → trust → Enter dispatches "trust".
		expect(selected).toEqual(["trust"]);
		expect(last).toBe("trust");
		expect(frames.length).toBeGreaterThanOrEqual(2); // initial + after the move
	});
});

describe("dashboardColorsFromTuiTheme (DS tokens → dashboard colorizers)", () => {
	it("maps a present token to a themed colorizer and falls back to the default for a missing one", () => {
		const colors = dashboardColorsFromTuiTheme({ primary: { ansi256: 33 }, "muted-foreground": { ansi256: 244 } });
		// primary + muted-foreground present → themed (not the chalk default reference).
		expect(colors.heading).not.toBe(defaultDashboardColors.heading);
		expect(colors.summary).not.toBe(defaultDashboardColors.summary);
		// foreground absent → the default name colorizer; focus stays the reliable inverse indicator.
		expect(colors.name).toBe(defaultDashboardColors.name);
		expect(colors.focused).toBe(defaultDashboardColors.focused);
	});

	it("an empty theme yields all default colorizers (graceful, no throw)", () => {
		const colors = dashboardColorsFromTuiTheme({});
		expect(colors.heading).toBe(defaultDashboardColors.heading);
		expect(colors.name).toBe(defaultDashboardColors.name);
		expect(colors.summary).toBe(defaultDashboardColors.summary);
	});
});
