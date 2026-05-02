import { describe, expect, it } from "vitest";
import {
	launchAvailabilityMessage,
	launchDryRunMessage,
	launchStartMessage,
	openDryRunMessage,
	openFailureMessage,
	openStartMessage,
} from "../../src/commands/launch-feedback.js";

describe("launch-feedback", () => {
	it("renders launch availability hint", () => {
		expect(launchAvailabilityMessage("Web", "dev|preview")).toBe(
			"Web launcher integration is available via --launch (dev|preview).",
		);
		expect(launchAvailabilityMessage("TUI", ["watch", "prompt"])).toBe(
			"TUI launcher integration is available via --launch (watch|prompt).",
		);
	});

	it("renders launch dry-run and start messages", () => {
		expect(launchDryRunMessage("web runtime", "npm run dev")).toBe(
			"[dry-run] would launch web runtime: npm run dev",
		);
		expect(launchStartMessage("TUI runtime", "cargo run -- watch")).toBe(
			"Launching TUI runtime: cargo run -- watch",
		);
	});

	it("renders browser open messages", () => {
		expect(openDryRunMessage("http://127.0.0.1:4321")).toBe(
			"[dry-run] would open browser URL: http://127.0.0.1:4321",
		);
		expect(openStartMessage("http://127.0.0.1:4321")).toBe(
			"Opening browser URL: http://127.0.0.1:4321",
		);
	});

	it("renders browser open failure messages", () => {
		expect(openFailureMessage(new Error("no browser available"))).toBe(
			"Failed to open browser URL: no browser available",
		);
		expect(openFailureMessage("unknown error")).toBe(
			"Failed to open browser URL: unknown error",
		);
	});
});
