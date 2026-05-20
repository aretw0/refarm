/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalPlugin } from "./index.js";

describe("TerminalPlugin", () => {
	afterEach(() => {
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	it("mounts, logs, clears, and tears down terminal output", async () => {
		vi.spyOn(console, "info").mockImplementation(() => {});
		const plugin = new TerminalPlugin();

		await plugin.setup();

		const terminal = document.body.querySelector(".refarm-card.refarm-mono");
		expect(terminal).not.toBeNull();
		expect(terminal?.textContent).toContain("System Terminal Online");

		plugin.log("Disk almost full", "warn");
		const lines = terminal?.querySelectorAll("div") ?? [];
		expect(lines).toHaveLength(2);
		expect(lines[1]?.textContent).toContain("[WARN] Disk almost full");
		expect((lines[1] as HTMLElement | undefined)?.style.color).toBe(
			"var(--refarm-warning)",
		);

		plugin.clear();
		expect(terminal?.textContent).toBe("");

		await plugin.teardown();
		expect(document.body.querySelector(".refarm-card.refarm-mono")).toBeNull();
	});

	it("exposes stable metadata", () => {
		vi.spyOn(console, "info").mockImplementation(() => {});
		const plugin = new TerminalPlugin();

		expect(plugin.metadata()).toEqual({
			name: "Refarm Terminal",
			version: "0.1.0",
			description: "Standardised output for plugins",
			supportedTypes: [],
			requiredCapabilities: [],
		});
	});
});
