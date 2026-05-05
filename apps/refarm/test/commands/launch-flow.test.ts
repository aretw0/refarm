import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeRendererLaunchFlow } from "../../src/commands/launch-flow.js";

function makeStatus(diagnostics: string[] = []) {
	return {
		schemaVersion: 1 as const,
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode: "headless",
		},
		renderer: {
			id: "refarm-headless",
			kind: "headless",
			capabilities: ["diagnostics"],
		},
		runtime: {
			ready: !diagnostics.includes("runtime:not-ready"),
			namespace: "refarm-main",
			databaseName: "refarm-main",
		},
		plugins: {
			installed: 0,
			active: 0,
			rejectedSurfaces: 0,
			surfaceActions: 0,
		},
		trust: {
			profile: "dev",
			warnings: diagnostics.includes("trust:warnings-present") ? 1 : 0,
			critical: diagnostics.includes("trust:critical-present") ? 1 : 0,
		},
		streams: { active: 0, terminal: 0 },
		diagnostics,
	};
}

describe("executeRendererLaunchFlow", () => {
	const initialBannerValue = process.env.REFARM_BRAND_BANNER;

	beforeEach(() => {
		process.env.REFARM_BRAND_BANNER = "0";
	});

	afterEach(() => {
		if (initialBannerValue === undefined) {
			delete process.env.REFARM_BRAND_BANNER;
			return;
		}
		process.env.REFARM_BRAND_BANNER = initialBannerValue;
	});

	it("no-ops when launch flag is not enabled", async () => {
		const resolveLaunchSpec = vi.fn(() => ({ display: "npm run dev" }));
		const launchProcess = vi.fn().mockResolvedValue(0);

		await executeRendererLaunchFlow({
			launch: false,
			dryRun: false,
			status: makeStatus(),
			launchGuardTarget: "web runtime",
			bannerExperience: "web",
			dryRunRuntimeLabel: "web runtime",
			startRuntimeLabel: "web runtime",
			resolveLaunchSpec,
			launchProcess,
		});

		expect(resolveLaunchSpec).not.toHaveBeenCalled();
		expect(launchProcess).not.toHaveBeenCalled();
	});

	it("handles dry-run without launching process", async () => {
		const spec = {
			command: "npm",
			args: ["run", "dev"],
			display: "npm run dev",
		};
		const resolveLaunchSpec = vi.fn(() => spec);
		const launchProcess = vi.fn().mockResolvedValue(0);
		const onDryRun = vi.fn();
		const log = vi.fn();

		await executeRendererLaunchFlow({
			launch: true,
			dryRun: true,
			status: makeStatus(),
			launchGuardTarget: "web runtime",
			bannerExperience: "web",
			dryRunRuntimeLabel: "web runtime",
			startRuntimeLabel: "web runtime",
			resolveLaunchSpec,
			launchProcess,
			onDryRun,
			log,
		});

		expect(resolveLaunchSpec).toHaveBeenCalled();
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("[dry-run] would launch web runtime"),
		);
		expect(onDryRun).toHaveBeenCalledWith(spec);
		expect(launchProcess).not.toHaveBeenCalled();
	});

	it("launches process and propagates non-zero exit code via callback", async () => {
		const spec = { command: "cargo", args: ["run"], display: "cargo run" };
		const resolveLaunchSpec = vi.fn(() => spec);
		const launchProcess = vi.fn().mockResolvedValue(4);
		const onLaunchStarted = vi.fn().mockResolvedValue(undefined);
		const setExitCode = vi.fn();
		const log = vi.fn();

		await executeRendererLaunchFlow({
			launch: true,
			dryRun: false,
			status: makeStatus(),
			launchGuardTarget: "TUI runtime",
			bannerExperience: "tui",
			dryRunRuntimeLabel: "tui runtime",
			startRuntimeLabel: "TUI runtime",
			resolveLaunchSpec,
			launchProcess,
			onLaunchStarted,
			setExitCode,
			log,
		});

		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("Launching TUI runtime"),
		);
		expect(launchProcess).toHaveBeenCalledWith(spec);
		expect(onLaunchStarted).toHaveBeenCalledWith(spec);
		expect(setExitCode).toHaveBeenCalledWith(4);
	});

	it("fails closed when launch policy diagnostics contain failures", async () => {
		const launchProcess = vi.fn().mockResolvedValue(0);

		await expect(
			executeRendererLaunchFlow({
				launch: true,
				dryRun: false,
				status: makeStatus(["runtime:not-ready"]),
				launchGuardTarget: "web runtime",
				bannerExperience: "web",
				dryRunRuntimeLabel: "web runtime",
				startRuntimeLabel: "web runtime",
				resolveLaunchSpec: () => ({ display: "npm run dev" }),
				launchProcess,
			}),
		).rejects.toThrow(/runtime:not-ready/);

		expect(launchProcess).not.toHaveBeenCalled();
	});
});
