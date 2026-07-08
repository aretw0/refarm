import {
	buildJsonSuccessEnvelope,
	createLocalVaultCommandDeps,
	defaultSourceDeps,
} from "@refarm.dev/capabilities-v1";
import { describe, expect, it } from "vitest";

import {
	defineCapabilityHost,
	type CapabilityHost,
	type CapabilityHostDefinition,
} from "./index.js";

describe("@refarm.dev/capability-host public API", () => {
	it("exposes the white-label host boundary without importing capabilities-v1 host symbols", async () => {
		const definition = {
			id: "examples/public-api",
			command: "dgk",
			description: "Digital Gardening Kit",
			capabilities: {
				deps: {
					source: defaultSourceDeps(),
					vault: createLocalVaultCommandDeps(),
				},
				extensions: [
					{
						name: "open",
						summary: "Open the workbench",
						transports: { cli: {}, http: { method: "GET", path: "/open" } },
						renderers: { tui: { section: "workbench" } },
						run: () =>
							buildJsonSuccessEnvelope({
								command: "open",
								operation: "render",
								extra: { opened: true },
							}),
					},
				],
			},
			operatorStatus: {
				capabilityUnit: {
					subject: "Workbench",
					action: {
						id: "open-workbench",
						label: "dgk open --json",
						command: "dgk open --json",
						primary: true,
					},
				},
			},
			serve: false,
		} satisfies CapabilityHostDefinition;

		const host: CapabilityHost = defineCapabilityHost(definition);
		expect(host.program().name()).toBe("dgk");
		expect(host.registry().get("open")).toBeDefined();
		expect(host.surfaceActions().map((action) => action.id)).toEqual([
			"open-workbench",
		]);
		expect(host.baseModel().nextCommands).toEqual(["dgk open --json"]);
	});
});
