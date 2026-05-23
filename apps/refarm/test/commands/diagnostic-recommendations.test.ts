import { describe, expect, it } from "vitest";
import {
	buildDiagnosticNextActionPayload,
	diagnosticNextActions,
} from "../../src/commands/diagnostic-recommendations.js";

describe("diagnostic recommendations", () => {
	it("deduplicates non-info next actions", () => {
		expect(
			diagnosticNextActions([
				{
					diagnostic: "runtime:not-ready",
					summary: "Runtime is not ready.",
					action: "Start runtime.",
					severity: "failure",
				},
				{
					diagnostic: "runtime:not-ready-again",
					summary: "Runtime is still not ready.",
					action: "Start runtime.",
					severity: "warning",
				},
				{
					diagnostic: "renderer:non-interactive",
					summary: "Renderer is non-interactive.",
					action: "Switch renderer.",
					severity: "info",
				},
			]),
		).toEqual(["Start runtime."]);
	});

	it("builds stable next-action JSON payloads with extra fields", () => {
		expect(
			buildDiagnosticNextActionPayload({
				ok: false,
				nextActions: ["Start runtime.", "Inspect trust."],
				strict: { enabled: true, passed: false },
			}),
		).toEqual({
			ok: false,
			nextAction: "Start runtime.",
			nextActions: ["Start runtime.", "Inspect trust."],
			strict: { enabled: true, passed: false },
		});
	});

	it("uses null when no next action is available", () => {
		expect(
			buildDiagnosticNextActionPayload({
				ok: true,
				nextActions: [],
			}),
		).toEqual({
			ok: true,
			nextAction: null,
			nextActions: [],
		});
	});
});
