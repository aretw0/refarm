import { describe, expect, it } from "vitest";
import {
	DEFAULT_HOMESTEAD_HOST_RENDERER_CAPABILITIES,
	createHomesteadHostRendererDescriptor,
	homesteadHostRendererCan,
	isHomesteadHostRendererKind,
	missingHomesteadHostRendererCapabilities,
	normalizeHomesteadHostRendererCapabilities,
} from "../src/sdk/host-renderer";

describe("Homestead host renderer contracts", () => {
	it("defines stable renderer kinds for Web, TUI, and headless hosts", () => {
		expect(isHomesteadHostRendererKind("web")).toBe(true);
		expect(isHomesteadHostRendererKind("tui")).toBe(true);
		expect(isHomesteadHostRendererKind("headless")).toBe(true);
		expect(isHomesteadHostRendererKind("mobile")).toBe(false);
		expect(isHomesteadHostRendererKind(undefined)).toBe(false);
	});

	it("assigns default capabilities by renderer kind", () => {
		const web = createHomesteadHostRendererDescriptor("studio-web", "web");
		const tui = createHomesteadHostRendererDescriptor("studio-tui", "tui");
		const headless = createHomesteadHostRendererDescriptor(
			"studio-headless",
			"headless",
		);

		expect(web.capabilities).toEqual(
			DEFAULT_HOMESTEAD_HOST_RENDERER_CAPABILITIES.web,
		);
		expect(tui.capabilities).toEqual(
			DEFAULT_HOMESTEAD_HOST_RENDERER_CAPABILITIES.tui,
		);
		expect(headless.capabilities).toEqual(
			DEFAULT_HOMESTEAD_HOST_RENDERER_CAPABILITIES.headless,
		);
		expect(homesteadHostRendererCan(web, "rich-html")).toBe(true);
		expect(homesteadHostRendererCan(tui, "rich-html")).toBe(false);
		expect(homesteadHostRendererCan(headless, "interactive")).toBe(false);
	});

	it("lets product distros narrow renderer capabilities", () => {
		const renderer = createHomesteadHostRendererDescriptor("ci", "headless", {
			label: "CI renderer",
			capabilities: ["telemetry", "diagnostics", "telemetry"],
			metadata: { owner: "apps/refarm" },
		});

		expect(renderer).toEqual({
			id: "ci",
			kind: "headless",
			label: "CI renderer",
			capabilities: ["telemetry", "diagnostics"],
			metadata: { owner: "apps/refarm" },
		});
		expect(
			missingHomesteadHostRendererCapabilities(renderer, [
				"telemetry",
				"surface-actions",
			]),
		).toEqual(["surface-actions"]);
	});

	it("normalizes capability lists without reordering first occurrence", () => {
		expect(
			normalizeHomesteadHostRendererCapabilities([
				"streams",
				"telemetry",
				"streams",
				"diagnostics",
			]),
		).toEqual(["streams", "telemetry", "diagnostics"]);
	});
});
