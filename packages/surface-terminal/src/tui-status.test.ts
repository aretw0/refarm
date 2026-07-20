import { describe, expect, it } from "vitest";

import { scriptedInput } from "./tui-input.js";
import {
	defaultStatusColors,
	renderStatusPanel,
	runInteractiveStatusPanel,
	statusPanelToLayout,
	type StatusPanelModel,
} from "./tui-status.js";

const model: StatusPanelModel = {
	units: [
		{ label: "Wallet", summary: "3 held items", severity: "ok", state: "verified" },
		{ label: "Runtime", summary: "sidecar not ready", severity: "warn", state: "pending" },
	],
	nextCommands: ["dgk verify --strict"],
};

describe("statusPanelToLayout", () => {
	it("maps units to a wrapping row of bordered cards over a Next footer", () => {
		const layout = statusPanelToLayout(model, { width: 80 });
		expect(layout.direction).toBe("column");

		const cardRow = layout.children![0]!;
		expect(cardRow.direction).toBe("row");
		expect(cardRow.wrap).toBe(true);
		expect(cardRow.children).toHaveLength(2);
		expect(cardRow.children![0]!.border).toBe(true);
		expect(cardRow.children![0]!.children![0]!.text).toBe("Wallet"); // label (identity colors)
		expect(cardRow.children![0]!.children![1]!.text).toBe("3 held items");

		const footer = layout.children![1]!;
		expect(footer.children![0]!.text).toBe("Next:");
		expect(footer.children![1]!.text).toBe("  → dgk verify --strict");
	});

	it("omits the Next footer when there are no next commands", () => {
		const layout = statusPanelToLayout({ units: model.units }, { width: 80 });
		expect(layout.children).toHaveLength(1); // just the card row, no footer
	});
});

describe("defaultStatusColors.severity", () => {
	it("maps severities to distinct colorizers (error/warn/ok) and identity otherwise", () => {
		const sev = defaultStatusColors.severity!;
		// Distinct chalk colorizers per severity; an unknown severity is a pass-through.
		expect(sev("error")).not.toBe(sev("ok"));
		expect(sev("warn")).not.toBe(sev("ok"));
		expect(sev("mystery")("x")).toBe("x"); // unknown → identity
	});
});

describe("renderStatusPanel", () => {
	it("renders the units side by side with labels, summaries, and the Next footer", async () => {
		const out = await renderStatusPanel(model, { width: 80 });
		expect(out).toContain("Wallet");
		expect(out).toContain("Runtime");
		expect(out).toContain("3 held items");
		expect(out).toContain("Next:");
		expect(out).toContain("dgk verify --strict");
		// The two cards sit side by side: the row holding "Wallet" also holds "Runtime".
		const nameRow = out.split("\n").find((line) => line.includes("Wallet"));
		expect(nameRow).toContain("Runtime");
	});
});

describe("statusPanelToLayout — focus highlighting", () => {
	it("styles the focused Next: command with the focus colorizer, others with next", () => {
		const layout = statusPanelToLayout(
			{ units: [], nextCommands: ["a", "b"] },
			{ width: 40, focusedCommandId: "b", colors: { focus: (t) => `<${t}>`, next: (t) => t } },
		);
		const json = JSON.stringify(layout);
		expect(json).toContain("<  → b>"); // focused, wrapped by the focus colorizer
		expect(json).toContain("  → a"); // not focused, plain
	});

	it("makes each Next: command a focusable target (id = the command)", () => {
		const layout = statusPanelToLayout({ units: [], nextCommands: ["dgk check"] }, { width: 40 });
		expect(JSON.stringify(layout)).toContain('"id":"dgk check","focusable":true');
	});
});

describe("runInteractiveStatusPanel", () => {
	const interactiveModel: StatusPanelModel = {
		units: [{ label: "Runtime", summary: "ready", severity: "ok" }],
		nextCommands: ["dgk check", "dgk doctor"],
	};

	it("navigates the Next: commands and fires onSelect with the focused one", async () => {
		const selected: string[] = [];
		const last = await runInteractiveStatusPanel(interactiveModel, {
			width: 60,
			input: scriptedInput([{ name: "down" }, { name: "return" }, { name: "escape" }]),
			output: () => {},
			onSelect: (command) => {
				selected.push(command);
			},
		});
		// initial focus = first command; ↓ moves to the second; Enter selects it.
		expect(selected).toEqual(["dgk doctor"]);
		expect(last).toBe("dgk doctor");
	});

	it("Enter on the initially-focused command runs it", async () => {
		const selected: string[] = [];
		await runInteractiveStatusPanel(interactiveModel, {
			width: 60,
			input: scriptedInput([{ name: "return" }, { name: "escape" }]),
			output: () => {},
			onSelect: (command) => {
				selected.push(command);
			},
		});
		expect(selected).toEqual(["dgk check"]);
	});
});
