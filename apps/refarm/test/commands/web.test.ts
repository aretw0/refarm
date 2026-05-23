import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createWebCommand,
	resolveBrowserOpenSpec,
	resolveWebLaunchSpec,
} from "../../src/commands/web.js";

function makeStatus(overrides?: Partial<any>) {
	return {
		schemaVersion: 1 as const,
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode: "web",
		},
		renderer: {
			id: "refarm-web",
			kind: "web",
			capabilities: ["interactive", "rich-html", "diagnostics"],
		},
		runtime: {
			ready: true,
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
			warnings: 0,
			critical: 0,
		},
		streams: { active: 0, terminal: 0 },
		diagnostics: [],
		...overrides,
	};
}

describe("resolveWebLaunchSpec", () => {
	const originalOverride = process.env.REFARM_PACKAGE_MANAGER;

	afterEach(() => {
		if (originalOverride === undefined) {
			delete process.env.REFARM_PACKAGE_MANAGER;
		} else {
			process.env.REFARM_PACKAGE_MANAGER = originalOverride;
		}
	});

	it("maps dev and preview launchers to deterministic commands", () => {
		expect(resolveWebLaunchSpec("dev")).toEqual({
			command: "pnpm",
			args: ["-C", "apps/dev", "run", "dev"],
			display: "pnpm -C apps/dev run dev",
		});
		expect(resolveWebLaunchSpec("preview")).toEqual({
			command: "pnpm",
			args: ["-C", "apps/dev", "run", "preview"],
			display: "pnpm -C apps/dev run preview",
		});
	});

	it("honors package manager override for launchers", () => {
		process.env.REFARM_PACKAGE_MANAGER = "npm";

		expect(resolveWebLaunchSpec("dev")).toEqual({
			command: "npm",
			args: ["--prefix", "apps/dev", "run", "dev"],
			display: "npm --prefix apps/dev run dev",
		});
	});
});

describe("resolveBrowserOpenSpec", () => {
	it("maps browser opener command by platform", () => {
		expect(resolveBrowserOpenSpec("http://localhost:4321", "darwin")).toEqual(
			expect.objectContaining({
				command: "open",
				args: ["http://localhost:4321"],
			}),
		);
		expect(resolveBrowserOpenSpec("http://localhost:4321", "win32")).toEqual(
			expect.objectContaining({
				command: "cmd",
				args: ["/c", "start", "", "http://localhost:4321"],
			}),
		);
		expect(resolveBrowserOpenSpec("http://localhost:4321", "linux")).toEqual(
			expect.objectContaining({
				command: "xdg-open",
				args: ["http://localhost:4321"],
			}),
		);
	});
});

describe("webCommand", () => {
	const resolveStatusPayload = vi.fn();
	const printStatusSummary = vi.fn();
	const launch = vi.fn();
	const open = vi.fn();
	const originalPackageManager = process.env.REFARM_PACKAGE_MANAGER;

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		process.env.REFARM_PACKAGE_MANAGER = "pnpm";
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus(),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		launch.mockResolvedValue(0);
		open.mockResolvedValue(undefined);
	});

	afterEach(() => {
		if (originalPackageManager === undefined) {
			delete process.env.REFARM_PACKAGE_MANAGER;
		} else {
			process.env.REFARM_PACKAGE_MANAGER = originalPackageManager;
		}
	});

	it("documents launch, dry-run, and action workflows in help", () => {
		let help = "";
		const command = createWebCommand();
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});
		command.outputHelp();

		expect(help).toContain("refarm web --launch --open");
		expect(help).toContain("refarm web --dry-run --launcher preview");
		expect(help).toContain("--dry-run prints the resolved package-manager command");
		expect(help).toContain("REFARM_PACKAGE_MANAGER=pnpm|npm|yarn|bun");
	});

	it("prints summary preflight by default", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync([], { from: "user" });

		expect(resolveStatusPayload).toHaveBeenCalledWith(
			expect.objectContaining({ renderer: "web" }),
		);
		expect(printStatusSummary).toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("available via --launch"),
		);
		expect(launch).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("prints Web action rows without launching", async () => {
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus({
				plugins: {
					installed: 1,
					active: 1,
					rejectedSurfaces: 0,
					surfaceActions: 1,
					availableActions: [
						{ id: "open-node", label: "Open node", intent: "node:open" },
					],
				},
			}),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--actions"], { from: "user" });

		expect(resolveStatusPayload).toHaveBeenCalledWith(
			expect.objectContaining({ renderer: "web" }),
		);
		expect(logSpy).toHaveBeenCalledWith(`Available Web actions:
  [1] Open node — open-node (node:open)`);
		expect(printStatusSummary).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("prints selected Web action dry-run metadata", async () => {
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus({
				plugins: {
					installed: 2,
					active: 2,
					rejectedSurfaces: 0,
					surfaceActions: 2,
					availableActions: [
						{ id: "open-node", label: "Open node" },
						{ id: "inspect-trust", label: "Inspect trust" },
					],
				},
			}),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--actions", "--select", "2"], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Selected Web action:"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("source: index"),
		);
		expect(launch).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("prints Web action readiness JSON envelopes", async () => {
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus({
				plugins: {
					installed: 1,
					active: 1,
					rejectedSurfaces: 0,
					surfaceActions: 1,
					availableActions: [{ id: "open-node", label: "Open node" }],
				},
			}),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--actions", "--select", "open-node", "--json"], {
			from: "user",
		});

		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "dry-run",
			readiness: { status: "ready", label: "Ready: yes" },
			renderer: "web",
			selection: {
				requested: "open-node",
				source: "id",
				resolvedId: "open-node",
				index: 1,
			},
			selectedAction: { id: "open-node", index: 1 },
			actionRows: [{ id: "open-node", index: 1 }],
		});
		expect(launch).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("prints blocked Web action JSON for unavailable selections", async () => {
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus({
				plugins: {
					installed: 1,
					active: 1,
					rejectedSurfaces: 0,
					surfaceActions: 1,
					availableActions: [{ id: "open-node", label: "Open node" }],
				},
			}),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--actions", "--select", "missing", "--json"], {
			from: "user",
		});

		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output).toMatchObject({
			reason: "dry-run",
			readiness: {
				status: "blocked",
				label: 'Blocked: host action "missing" is not available',
			},
			renderer: "web",
			actionRows: [{ id: "open-node", index: 1 }],
		});
		expect(output).not.toHaveProperty("selection");
		expect(output).not.toHaveProperty("selectedAction");
		expect(launch).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("rejects Web action selection without --actions", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});

		await expect(
			command.parseAsync(["--select", "open-node"], { from: "user" }),
		).rejects.toThrow(/--select requires --actions/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
	});

	it("rejects Web action rows with launch-only flags", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});

		await expect(
			command.parseAsync(["--actions", "--launch"], { from: "user" }),
		).rejects.toThrow(/--actions cannot be combined/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
	});

	it("launches dev mode when --launch is requested", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--launch"], { from: "user" });

		expect(launch).toHaveBeenCalledWith(
			expect.objectContaining({
				display: "pnpm -C apps/dev run dev",
			}),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Launching web runtime"),
		);
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("REFARM"));
		logSpy.mockRestore();
	});

	it("launches preview mode with --launcher preview", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});

		await command.parseAsync(["--launch", "--launcher", "preview"], {
			from: "user",
		});

		expect(launch).toHaveBeenCalledWith(
			expect.objectContaining({
				display: "pnpm -C apps/dev run preview",
			}),
		);
	});

	it("rejects invalid launcher mode", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});
		command.exitOverride((error) => {
			throw error;
		});

		await expect(
			command.parseAsync(["--launch", "--launcher", "invalid"], {
				from: "user",
			}),
		).rejects.toThrow(/Invalid --launcher value/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
	});

	it("fails when runtime is not ready for launch", async () => {
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus({
				runtime: { ready: false, namespace: "", databaseName: "" },
				diagnostics: ["runtime:not-ready"],
			}),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});

		await expect(
			command.parseAsync(["--launch"], { from: "user" }),
		).rejects.toThrow(/runtime:not-ready/);
		expect(launch).not.toHaveBeenCalled();
	});

	it("fails launch when status has critical trust diagnostics", async () => {
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus({
				trust: { profile: "strict", warnings: 0, critical: 1 },
				diagnostics: ["trust:critical-present"],
			}),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});

		await expect(
			command.parseAsync(["--launch"], { from: "user" }),
		).rejects.toThrow(/trust:critical-present/);
		expect(launch).not.toHaveBeenCalled();
	});

	it("rejects --launch with --json", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});

		await expect(
			command.parseAsync(["--launch", "--json"], { from: "user" }),
		).rejects.toThrow(/cannot be combined/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
	});

	it("rejects --dry-run without --launch", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});

		await expect(
			command.parseAsync(["--dry-run"], { from: "user" }),
		).rejects.toThrow(/requires --launch/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
	});

	it("rejects --open without --launch", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});

		await expect(
			command.parseAsync(["--open"], { from: "user" }),
		).rejects.toThrow(/requires --launch/);
		expect(resolveStatusPayload).not.toHaveBeenCalled();
	});

	it("prints dry-run command without launching process", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--launch", "--dry-run"], { from: "user" });

		expect(launch).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("[dry-run] would launch web runtime"),
		);
		logSpy.mockRestore();
	});

	it("prints dry-run browser open command", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--launch", "--dry-run", "--open"], {
			from: "user",
		});

		expect(launch).not.toHaveBeenCalled();
		expect(open).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("[dry-run] would open browser URL"),
		);
		logSpy.mockRestore();
	});

	it("opens browser URL when --open is used", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});

		await command.parseAsync(["--launch", "--open"], { from: "user" });

		expect(open).toHaveBeenCalledWith("http://127.0.0.1:4321");
	});

	it("supports custom browser URL", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});

		await command.parseAsync(
			["--launch", "--open", "--open-url", "http://localhost:9999"],
			{ from: "user" },
		);

		expect(open).toHaveBeenCalledWith("http://localhost:9999");
	});

	it("continues when browser opener fails", async () => {
		open.mockRejectedValue(new Error("no browser available"));
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await command.parseAsync(["--launch", "--open"], { from: "user" });

		expect(launch).toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Failed to open browser URL"),
		);
		errorSpy.mockRestore();
	});

	it("propagates launcher non-zero exit code", async () => {
		launch.mockResolvedValue(3);
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
			open,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--launch"], { from: "user" });

		expect(process.exitCode).toBe(3);
		logSpy.mockRestore();
	});
});
