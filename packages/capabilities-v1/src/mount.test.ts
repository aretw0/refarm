import {
	isCapabilityGroup,
	type CapabilityDescriptor,
} from "@refarm.dev/cli/capabilities";
import { describe, expect, it } from "vitest";

import {
	defaultRecordsDeps,
	defaultSourceDeps,
	defaultVaultDeps,
	mountCapabilities,
	mountedCliCommands,
	type RefarmCapabilityDeps,
} from "./index.js";

function deps(): RefarmCapabilityDeps {
	return {
		source: defaultSourceDeps(),
		vault: defaultVaultDeps({
			discover: () => ({ providers: [], rejected: [] }),
			submitEffort: async (e) => e.id,
		}),
		records: defaultRecordsDeps(),
	};
}

const myVerb: CapabilityDescriptor = {
	name: "hello",
	summary: "a work verb",
	run: () => ({ ok: true }) as never,
};

describe("mountCapabilities — the consumer-mount seam", () => {
	it("composes the neutral built-ins with the app's own verbs", () => {
		const registry = mountCapabilities({ deps: deps(), verbs: [myVerb] });
		const names = registry.list().map((e) => e.name);
		expect(names).toEqual(expect.arrayContaining(["source", "records", "vault", "hello"]));
	});

	it("surfaces a plugin manifest's verb via the bridge (extension path)", () => {
		const registry = mountCapabilities({
			deps: deps(),
			manifests: [
				{ id: "@w/x", capabilities: { provides: ["x:go"], subscribes: ["x:dispatch"] } },
			],
			pluginDeps: {
				submitEffort: async (e) => e.id,
				newId: () => "id-1",
				nowIso: () => "2026-01-01T00:00:00Z",
			},
		});
		expect(registry.list().map((e) => e.name)).toContain("go");
	});

	it("throws if manifests are given without pluginDeps", () => {
		expect(() =>
			mountCapabilities({
				deps: deps(),
				manifests: [{ id: "@w/x", capabilities: { provides: ["x:go"], subscribes: ["x:dispatch"] } }],
			}),
		).toThrow(/pluginDeps/);
	});

	it("projects the mounted registry onto CLI commands", () => {
		const registry = mountCapabilities({ deps: deps(), verbs: [myVerb] });
		const commandNames = mountedCliCommands(registry).map((c) => c.name());
		expect(commandNames).toContain("hello");
		// The neutral source group projects as a top-level command too.
		const source = registry.list().find((e) => e.name === "source");
		expect(source && isCapabilityGroup(source)).toBe(true);
	});
});
