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
			observeSupervisionLifetime: async () => ({ state: "enabled", detail: "enabled" }),
		});
		expect(units.every((unit) => unit.state === "ready")).toBe(true);
		expect(JSON.stringify(units)).not.toContain("token");
		expect(units[0]?.details).toMatchObject({ enrolledDevices: 1, gatedSurfaces: 2 });
		expect(units.flatMap((unit) => unit.actions)).toEqual([]);
	});

	it("a unit that GAVE UP is a failure, and the action leads to why rather than to a retry", async () => {
		// MEASURED 2026-08-22: `refarm-web-serve` gave up at boot after six restarts and sat there
		// for 33 hours. Restarting it again was never the useful next act — systemd had already
		// tried six times. The journal is the only thing that says WHY, and it is the one artefact
		// a failed unit is guaranteed to have.
		const units = await resolveOperationalReadinessUnits({
			config: {
				processes: {
					"web-serve": {
						description: "the mesh distribution server",
						command: ["/usr/local/bin/refarm", "web", "serve"],
						restart: "always",
					},
				},
			},
			credentialCount: 0,
			observeProcesses: async () => [
				{
					name: "web-serve",
					state: "failed",
					detail: "refarm-web-serve.service is failed (failed)",
					backend: "systemd-user",
					supervised: true,
				},
			],
			observeDistribution: (directory) => ({ directory, manifest: true, installer: true }),
		});
		const supervision = units.find((unit) => unit.id === "supervision");
		// Not merely "degraded, warning" — the same grade a process nobody started would get.
		expect(supervision?.severity).toBe("failure");
		expect(supervision?.actions[0]).toMatchObject({
			id: "diagnose-web-serve",
			intent: "process:diagnose",
			primary: true,
		});
		expect(supervision?.actions[0]?.command).toContain("journalctl --user -u refarm-web-serve.service");
	});

	it("re-arms the SCHEDULE, not the service, when a periodic process has no timer left", async () => {
		// The branch the scheduled-process fix opened, and the way it would go wrong: restarting the
		// SERVICE of a periodic process runs it once and leaves the timer disarmed, so the problem
		// returns silently on the next interval that never comes. `refarm process install` writes
		// both units; what a disarmed one needs is the timer back.
		const units = await resolveOperationalReadinessUnits({
			config: {
				processes: {
					"credential-renew": {
						description: "renews short-lived credentials before they expire",
						command: ["/usr/bin/refarm", "credential", "renew"],
						restart: "on-failure",
						everySeconds: 120,
					},
				},
			},
			credentialCount: 0,
			observeProcesses: async () => [
				{
					name: "credential-renew",
					state: "not-running",
					detail: "refarm-credential-renew.timer is inactive — nothing will wake it again",
					backend: "systemd-user",
					supervised: true,
				},
			],
			observeDistribution: (directory) => ({ directory, manifest: true, installer: true }),
		});
		const supervision = units.find((unit) => unit.id === "supervision");
		expect(supervision?.actions[0]?.command).toBe(
			"systemctl --user restart refarm-credential-renew.timer",
		);
		expect(supervision?.actions[0]?.id).toBe("rearm-credential-renew");
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

	it("does not call device distribution durable while it still stops at logout", async () => {
		const units = await resolveOperationalReadinessUnits({
			config: {
				processes: {
					"web-serve": {
						command: ["/usr/bin/refarm", "web", "serve", "/srv/refarm/farm-client"],
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
			observeSupervisionLifetime: async () => ({ state: "disabled", detail: "off" }),
			observeDistribution: (directory) => ({ directory, manifest: true, installer: true }),
		});
		const supervision = units.find((unit) => unit.id === "supervision");
		expect(supervision).toMatchObject({
			state: "degraded",
			summary: "All declared processes are running, but device distribution stops at logout.",
			details: { requiresDurability: true, lifetime: { state: "disabled" } },
		});
		expect(supervision?.actions[0]?.command).toBe("refarm process linger");
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
