import type { SurfaceModel } from "@refarm.dev/capabilities";
import { describe, expect, it } from "vitest";

import { renderCapabilityDashboard, surfaceModelToLayout } from "./tui-dashboard.js";

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
