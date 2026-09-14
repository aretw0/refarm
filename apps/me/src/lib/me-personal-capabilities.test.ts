import { describe, expect, it } from "vitest";
import {
	createRefarmMePersonalCapabilities,
	createRefarmMePersonalCapabilitySurface,
	REFARM_ME_PERSONAL_CAPABILITY_SURFACE_PLUGIN_ID,
	type RefarmMePersonalStatus,
} from "./me-personal-capabilities";

const STATUS: RefarmMePersonalStatus = {
	profileName: "My Sovereign Space",
	identityStatus: "unauthenticated",
	syncStatus: "waiting-for-tractor",
	graphMode: "bootstrap",
	storageScope: "refarm-me-main",
	syncScope: "citizen",
	pluginRegistryCount: 2,
	discoveredContentPluginCount: 1,
	referenceDriverCapabilityIds: ["records:v1"],
	scheduledWorkSummary: { total: 1, due: 0, declared: 1, unsupported: 0 },
};

const INPUT = { args: {}, options: {}, json: false };

describe("createRefarmMePersonalCapabilities", () => {
	it("declares the hub's personal verbs — status and profile", () => {
		const names = createRefarmMePersonalCapabilities(() => STATUS).map((c) => c.name);
		expect(names).toEqual(["status", "profile"]);
	});

	it("status returns the hub's posture as an honest envelope", async () => {
		const status = createRefarmMePersonalCapabilities(() => STATUS).find(
			(c) => c.name === "status",
		);
		const envelope = await status!.run(INPUT);
		expect(envelope).toMatchObject({
			ok: true,
			command: "me",
			operation: "status",
			identityStatus: "unauthenticated",
			syncStatus: "waiting-for-tractor",
			graphMode: "bootstrap",
			pluginRegistryCount: 2,
			discoveredContentPluginCount: 1,
			referenceDriverCapabilityCount: 1,
			scheduledWorkSummary: { total: 1, due: 0, declared: 1, unsupported: 0 },
		});
	});

	it("status samples the thunk at run time, not construction time", async () => {
		let syncStatus = "waiting-for-tractor";
		const capabilities = createRefarmMePersonalCapabilities(() => ({
			...STATUS,
			syncStatus,
		}));
		syncStatus = "synced";
		const envelope = await capabilities.find((c) => c.name === "status")!.run(INPUT);
		expect(envelope).toMatchObject({ syncStatus: "synced" });
	});

	it("profile returns the citizen's identity scopes", async () => {
		const profile = createRefarmMePersonalCapabilities(() => STATUS).find(
			(c) => c.name === "profile",
		);
		const envelope = await profile!.run(INPUT);
		expect(envelope).toMatchObject({
			ok: true,
			command: "me",
			operation: "profile",
			profileName: "My Sovereign Space",
			storageScope: "refarm-me-main",
			syncScope: "citizen",
		});
	});
});

describe("createRefarmMePersonalCapabilitySurface", () => {
	it("renders the registry-derived panel headlessly with both verbs as cards", async () => {
		const handle = createRefarmMePersonalCapabilitySurface(() => STATUS);
		expect(handle.id).toBe(REFARM_ME_PERSONAL_CAPABILITY_SURFACE_PLUGIN_ID);
		const result = (await handle.call("renderHomesteadSurface", {})) as { html: string };
		expect(result?.html).toContain("data-capability-web-surface");
		expect(result.html).toContain("status");
		expect(result.html).toContain("profile");
	});
});
