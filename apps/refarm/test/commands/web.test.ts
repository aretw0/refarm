import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createWebCommand,
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
	it("maps dev and preview launchers to deterministic commands", () => {
		expect(resolveWebLaunchSpec("dev")).toEqual({
			command: "npm",
			args: ["--prefix", "apps/dev", "run", "dev"],
			display: "npm --prefix apps/dev run dev",
		});
		expect(resolveWebLaunchSpec("preview")).toEqual({
			command: "npm",
			args: ["--prefix", "apps/dev", "run", "preview"],
			display: "npm --prefix apps/dev run preview",
		});
	});
});

describe("webCommand", () => {
	const resolveStatusPayload = vi.fn();
	const printStatusSummary = vi.fn();
	const launch = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus(),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		launch.mockResolvedValue(0);
	});

	it("prints summary preflight by default", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
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

	it("launches dev mode when --launch is requested", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--launch"], { from: "user" });

		expect(launch).toHaveBeenCalledWith(
			expect.objectContaining({
				display: "npm --prefix apps/dev run dev",
			}),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Launching web runtime"),
		);
		logSpy.mockRestore();
	});

	it("launches preview mode with --launcher preview", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await command.parseAsync(["--launch", "--launcher", "preview"], {
			from: "user",
		});

		expect(launch).toHaveBeenCalledWith(
			expect.objectContaining({
				display: "npm --prefix apps/dev run preview",
			}),
		);
	});

	it("fails when runtime is not ready for launch", async () => {
		resolveStatusPayload.mockResolvedValue({
			json: makeStatus({
				runtime: { ready: false, namespace: "", databaseName: "" },
			}),
			shutdown: vi.fn().mockResolvedValue(undefined),
		});
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await expect(
			command.parseAsync(["--launch"], { from: "user" }),
		).rejects.toThrow(/runtime:not-ready/);
		expect(launch).not.toHaveBeenCalled();
	});

	it("rejects --launch with --json", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await expect(
			command.parseAsync(["--launch", "--json"], { from: "user" }),
		).rejects.toThrow(/cannot be combined/);
	});

	it("rejects --dry-run without --launch", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});

		await expect(
			command.parseAsync(["--dry-run"], { from: "user" }),
		).rejects.toThrow(/requires --launch/);
	});

	it("prints dry-run command without launching process", async () => {
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--launch", "--dry-run"], { from: "user" });

		expect(launch).not.toHaveBeenCalled();
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("[dry-run] would launch web runtime"),
		);
		logSpy.mockRestore();
	});

	it("propagates launcher non-zero exit code", async () => {
		launch.mockResolvedValue(3);
		const command = createWebCommand({
			resolveStatusPayload,
			printStatusSummary,
			launch,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--launch"], { from: "user" });

		expect(process.exitCode).toBe(3);
		logSpy.mockRestore();
	});
});
