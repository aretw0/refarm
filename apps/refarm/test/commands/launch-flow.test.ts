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
		const resolveLaunchSpec = vi.fn(() => ({ display: "runner dev" }));
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
			command: "runner",
			args: ["dev"],
			display: "runner dev",
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

	it("prints machine-readable dry-run launch envelopes", async () => {
		const spec = {
			command: "runner",
			args: ["dev"],
			display: "runner dev",
		};
		const resolveLaunchSpec = vi.fn(() => spec);
		const launchProcess = vi.fn().mockResolvedValue(0);
		const onDryRun = vi.fn();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await executeRendererLaunchFlow({
			launch: true,
			dryRun: true,
			dryRunJson: true,
			dryRunJsonCommand: "web",
			dryRunJsonExtra: () => ({ renderer: "web", launcher: "dev" }),
			status: makeStatus(),
			launchGuardTarget: "web runtime",
			bannerExperience: "web",
			dryRunRuntimeLabel: "web runtime",
			startRuntimeLabel: "web runtime",
			resolveLaunchSpec,
			launchProcess,
			onDryRun,
		});

		expect(resolveLaunchSpec).toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "web",
			operation: "dry-run",
			ok: true,
			reason: "dry-run",
			renderer: "web",
			launcher: "dev",
			runtimeLabel: "web runtime",
			launchReady: true,
			launchFailures: [],
			launchCommand: "runner dev",
			launchSpec: spec,
			nextCommand: "runner dev",
			nextCommands: ["runner dev"],
		});
		expect(onDryRun).toHaveBeenCalledWith(spec);
		expect(launchProcess).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("prints blocked machine-readable dry-run envelopes without launching", async () => {
		const spec = {
			command: "runner",
			args: ["dev"],
			display: "runner dev",
		};
		const resolveLaunchSpec = vi.fn(() => spec);
		const launchProcess = vi.fn().mockResolvedValue(0);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await executeRendererLaunchFlow({
			launch: true,
			dryRun: true,
			dryRunJson: true,
			dryRunJsonCommand: "web",
			dryRunJsonNextCommand: "refarm web --launch --launcher dev",
			status: makeStatus(["runtime:not-ready"]),
			launchGuardTarget: "web runtime",
			bannerExperience: "web",
			dryRunRuntimeLabel: "web runtime",
			startRuntimeLabel: "web runtime",
			resolveLaunchSpec,
			launchProcess,
		});

		expect(resolveLaunchSpec).toHaveBeenCalled();
		expect(launchProcess).not.toHaveBeenCalled();
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "web",
			operation: "dry-run",
			ok: true,
			launchReady: false,
			launchFailures: ["runtime:not-ready"],
			nextAction:
				"Cannot launch web runtime due status failures: runtime:not-ready. Run `refarm runtime status`, then `refarm runtime ensure --wait --next-command`.",
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: [
				"refarm runtime ensure --wait --next-command",
				"refarm doctor --next-command",
			],
			launchCommand: "runner dev",
		});
		logSpy.mockRestore();
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
				resolveLaunchSpec: () => ({ display: "runner dev" }),
				launchProcess,
			}),
		).rejects.toThrow(/runtime:not-ready/);

		expect(launchProcess).not.toHaveBeenCalled();
	});
});
