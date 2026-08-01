import { describe, expect, it } from "vitest";
import { resolveOperationalReadinessUnits } from "./operational-readiness.js";

describe("operational readiness surface units", () => {
	it("names the missing declarations without inventing completed work", async () => {
		const units = await resolveOperationalReadinessUnits({ config: {}, credentialCount: 0 });
		expect(units.map((unit) => unit.id)).toEqual(["device-access", "supervision"]);
		expect(units.flatMap((unit) => unit.actions.map((action) => action.command))).toEqual([
			"refarm surface add web",
			"refarm surface add sidecar-http",
			"refarm surface add daemon-ws",
			"refarm process add web-serve",
		]);
		expect(units.every((unit) => unit.state === "degraded")).toBe(true);
	});

	it("reports declarations and enrolled-device count without credential material", async () => {
		const units = await resolveOperationalReadinessUnits({
			config: {
				surfaces: {
					"sidecar-http": { expose: "tailnet", gate: "device-token" },
					"daemon-ws": { expose: "tailnet", gate: "device-token" },
					web: { expose: "tailnet", gate: "none" },
				},
				processes: {
					"web-serve": {
						description: "web",
						command: ["/usr/bin/refarm", "web", "serve"],
						restart: "always",
					},
				},
			},
			credentialCount: 1,
			observeProcesses: async () => [
				{
					name: "web-serve",
					state: "running",
					detail: "active",
					backend: "systemd-user",
					supervised: true,
				},
			],
		});
		expect(units.every((unit) => unit.state === "ready")).toBe(true);
		expect(JSON.stringify(units)).not.toContain("token");
		expect(units[0]?.details).toMatchObject({ enrolledDevices: 1, gatedSurfaces: 2 });
		expect(units.flatMap((unit) => unit.actions)).toEqual([]);
	});

	it("turns an installed stopped process into a renderer-neutral restart action", async () => {
		const units = await resolveOperationalReadinessUnits({
			config: {
				processes: {
					"web-serve": {
						description: "web",
						command: ["/usr/bin/refarm", "web", "serve"],
						restart: "always",
					},
				},
			},
			credentialCount: 0,
			observeProcesses: async () => [
				{
					name: "web-serve",
					state: "not-running",
					detail: "failed",
					backend: "systemd-user",
					supervised: true,
				},
			],
			observeDistribution: (directory) => ({ directory, manifest: true, installer: true }),
		});
		const supervision = units.find((unit) => unit.id === "supervision");
		expect(supervision).toMatchObject({ state: "degraded", severity: "warning" });
		expect(supervision?.actions[0]?.command).toBe(
			"systemctl --user restart refarm-web-serve.service",
		);
	});

	it("does not call a running empty static server a ready distribution", async () => {
		const servedRoot = "/srv/refarm/farm-client";
		const units = await resolveOperationalReadinessUnits({
			config: {
				processes: {
					"web-serve": {
						command: ["/usr/bin/refarm", "web", "serve", servedRoot, "--port", "4321"],
						restart: "always",
					},
				},
			},
			credentialCount: 0,
			observeProcesses: async () => [
				{
					name: "web-serve",
					state: "running",
					detail: "active",
					backend: "systemd-user",
					supervised: true,
				},
			],
			observeDistribution: (directory) => ({ directory, manifest: false, installer: false }),
		});
		const distribution = units.find((unit) => unit.id === "distribution");
		expect(distribution).toMatchObject({
			state: "degraded",
			severity: "warning",
			details: {
				directory: servedRoot,
				missingFiles: ["manifest.json", "install.mjs"],
			},
		});
		expect(distribution?.summary).toContain("answer 404");
		expect(distribution?.actions[0]?.command).toBe("refarm process add web-serve --replace");
	});

	it("asks for enrollment only when a declared surface actually has a credential gate", async () => {
		const units = await resolveOperationalReadinessUnits({
			config: { surfaces: { "daemon-ws": { expose: "tailnet", gate: "device-token" } } },
			credentialCount: 0,
		});
		expect(units[0]?.actions.map((action) => action.command)).toEqual([
			"refarm surface add web",
			"refarm surface add sidecar-http",
			"refarm auth enroll <device-label>",
		]);
	});

	it("does not call an open web surface complete device access", async () => {
		const units = await resolveOperationalReadinessUnits({
			config: { surfaces: { web: { expose: "tailnet", gate: "none" } } },
			credentialCount: 0,
		});
		expect(units[0]?.state).toBe("degraded");
		expect(units[0]?.details).toMatchObject({
			missingSurfaces: ["sidecar-http", "daemon-ws"],
		});
	});
});
