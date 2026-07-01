/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	HERALD_IDENTITY_STATUS_ID,
	HeraldPlugin,
} from "../src/sdk/Herald";
import type { StudioHost } from "../src/sdk/studio-host";

describe("HeraldPlugin", () => {
	let tractor: StudioHost;

	beforeEach(() => {
		document.body.innerHTML = "";
		tractor = {
			plugins: {
				get: vi.fn(),
				getAllPlugins: vi.fn().mockReturnValue([]),
			},
			observe: vi.fn(),
			emitTelemetry: vi.fn(),
			onNode: vi.fn(),
			getHelpNodes: vi.fn().mockResolvedValue([]),
			switchTier: vi.fn(),
		};
	});

	it("renders identity status into the shell health affordance", () => {
		document.body.innerHTML = `
			<div id="refarm-slot-statusbar">
				<span id="system-health">pending</span>
			</div>
		`;

		new HeraldPlugin(tractor, { identityStatus: "unauthenticated" });

		const health = document.getElementById("system-health");
		expect(health?.textContent).toBe("Identity: unauthenticated");
		expect(health?.dataset.refarmHeraldIdentityStatus).toBe("unauthenticated");
		expect(tractor.observe).toHaveBeenCalledWith(expect.any(Function));
	});

	it("creates a Herald-owned identity status node when the layout has no health node", () => {
		document.body.innerHTML = `<div id="refarm-slot-statusbar"></div>`;

		new HeraldPlugin(tractor, { identityStatus: "authenticated" });

		const identity = document.getElementById(HERALD_IDENTITY_STATUS_ID);
		expect(identity?.textContent).toBe("Identity: authenticated");
		expect(identity?.dataset.refarmHeraldIdentityStatus).toBe("authenticated");
	});

	it("does not treat identity status as HTML", () => {
		document.body.innerHTML = `
			<div id="refarm-slot-statusbar">
				<span id="system-health"></span>
			</div>
		`;

		new HeraldPlugin(tractor, {
			identityStatus: '<img src=x onerror="alert(1)">',
		});

		const health = document.getElementById("system-health");
		expect(health?.textContent).toContain('<img src=x onerror="alert(1)">');
		expect(health?.querySelector("img")).toBeNull();
	});
});
