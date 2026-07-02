/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FireflyPlugin } from "../src/sdk/Firefly";
import type {
	StudioHost,
	StudioHostTelemetryEvent,
} from "../src/sdk/studio-host";

describe("FireflyPlugin", () => {
	let telemetryHandlers: Array<(event: StudioHostTelemetryEvent) => void>;
	let tractor: StudioHost;

	beforeEach(() => {
		document.head.innerHTML = "";
		document.body.innerHTML = "";
		telemetryHandlers = [];
		tractor = {
			plugins: {
				get: vi.fn(),
				getAllPlugins: vi.fn().mockReturnValue([]),
			},
			observe: vi.fn((handler) => {
				telemetryHandlers.push(handler);
			}),
			emitTelemetry: vi.fn(),
			onNode: vi.fn(),
			getHelpNodes: vi.fn().mockResolvedValue([]),
			switchTier: vi.fn(),
		};
	});

	it("renders system alert toasts without treating messages as HTML", () => {
		new FireflyPlugin(tractor);

		telemetryHandlers[0]?.({
			event: "system:alert",
			payload: {
				reason: 'Cache ready <img src=x onerror="alert(1)">',
				severity: "info",
			},
		});

		const toast = document.getElementById("refarm-firefly-toast");
		expect(document.getElementById("refarm-firefly-styles")).not.toBeNull();
		expect(toast?.textContent).toContain(
			'Cache ready <img src=x onerror="alert(1)">',
		);
		expect(toast?.querySelector("img")).toBeNull();
		expect(toast?.querySelector("button")).toBeNull();
	});

	it("renders actionable update notifications", () => {
		new FireflyPlugin(tractor);

		telemetryHandlers[0]?.({ event: "system:update_ready" });

		const toast = document.getElementById("refarm-firefly-toast");
		const button = toast?.querySelector<HTMLButtonElement>("#firefly-refresh");
		expect(toast?.textContent).toContain("Update ready");
		expect(button?.textContent).toBe("Refresh");
	});

	it("spotlights guidance targets and returns a cleanup handle", () => {
		const target = document.createElement("button");
		target.id = "open-vault";
		document.body.appendChild(target);
		const firefly = new FireflyPlugin(tractor);

		const cleanup = firefly.spotlight("open-vault", "Open the vault");

		expect(document.getElementById("firefly-overlay")).not.toBeNull();
		expect(target.classList.contains("firefly-focused")).toBe(true);
		expect(document.getElementById("refarm-firefly-toast")?.textContent).toContain(
			"Open the vault",
		);

		cleanup?.();
		expect(document.getElementById("firefly-overlay")).toBeNull();
		expect(target.classList.contains("firefly-focused")).toBe(false);
	});
});
