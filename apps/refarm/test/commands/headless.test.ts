import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveStatusPayload, mockShutdown, mockPrintStatusSummary } =
	vi.hoisted(() => ({
		mockResolveStatusPayload: vi.fn(),
		mockShutdown: vi.fn().mockResolvedValue(undefined),
		mockPrintStatusSummary: vi.fn(),
	}));

vi.mock("../../src/commands/status.js", () => ({
	resolveStatusPayload: mockResolveStatusPayload,
	printStatusSummary: mockPrintStatusSummary,
}));

import { headlessCommand } from "../../src/commands/headless.js";

function makeStatus() {
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
	};
}

describe("headlessCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockResolveStatusPayload.mockResolvedValue({
			json: makeStatus(),
			shutdown: mockShutdown,
		});
	});

	it("documents automation output and dry-run action requests in help", () => {
		let help = "";
		headlessCommand.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});
		headlessCommand.outputHelp();

		expect(help).toContain("refarm headless --action-request <id-or-index>");
		expect(help).toContain("Default output is JSON for automation");
		expect(help).toContain("it does not open browsers or mutate state");
	});

	it("outputs JSON by default", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await headlessCommand.parseAsync([], { from: "user" });

		expect(mockResolveStatusPayload).toHaveBeenCalledWith(
			expect.objectContaining({ renderer: "headless" }),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("schemaVersion"),
		);
		expect(mockShutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("outputs markdown with --markdown", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await headlessCommand.parseAsync(["--markdown"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("# Refarm Status"),
		);
		logSpy.mockRestore();
	});

	it("outputs a dry-run action request with --action-request", async () => {
		mockResolveStatusPayload.mockResolvedValueOnce({
			json: {
				...makeStatus(),
				plugins: {
					installed: 1,
					active: 1,
					rejectedSurfaces: 0,
					surfaceActions: 1,
					availableActions: [
						{ id: "open-node", label: "Open node", intent: "node:open" },
					],
				},
			},
			shutdown: mockShutdown,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await headlessCommand.parseAsync(["--action-request", "open-node"], {
			from: "user",
		});

		const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(output).toMatchObject({
			schemaVersion: 1,
			command: "headless",
			operation: "action-dry-run",
			statusSchemaVersion: 1,
			reason: "dry-run",
			renderer: "headless",
			readiness: { status: "ready", label: "Ready: yes" },
			selection: {
				requested: "open-node",
				source: "id",
				resolvedId: "open-node",
				index: 1,
			},
			actionRequest: {
				pluginId: "apps/refarm",
				slotId: "headless",
				action: { id: "open-node", label: "Open node", intent: "node:open" },
			},
		});
		expect(mockShutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("accepts a one-based action row index with --action-request", async () => {
		mockResolveStatusPayload.mockResolvedValueOnce({
			json: {
				...makeStatus(),
				plugins: {
					installed: 2,
					active: 2,
					rejectedSurfaces: 0,
					surfaceActions: 2,
					availableActions: [
						{ id: "open-node", label: "Open node", intent: "node:open" },
						{ id: "inspect-trust", label: "Inspect trust" },
					],
				},
			},
			shutdown: mockShutdown,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await headlessCommand.parseAsync(["--action-request", "2"], {
			from: "user",
		});

		const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(output.selection).toEqual({
			requested: "2",
			source: "index",
			resolvedId: "inspect-trust",
			index: 2,
		});
		expect(output.actionRequest.action).toMatchObject({
			id: "inspect-trust",
			label: "Inspect trust",
		});
		expect(mockShutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("emits blocked dry-run readiness when the action is unavailable", async () => {
		mockResolveStatusPayload.mockResolvedValueOnce({
			json: {
				...makeStatus(),
				plugins: {
					installed: 1,
					active: 1,
					rejectedSurfaces: 0,
					surfaceActions: 1,
					availableActions: [{ id: "open-node", label: "Open node" }],
				},
			},
			shutdown: mockShutdown,
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await headlessCommand.parseAsync(["--action-request", "missing-action"], {
			from: "user",
		});

		const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(output).toMatchObject({
			schemaVersion: 1,
			command: "headless",
			operation: "action-dry-run",
			statusSchemaVersion: 1,
			reason: "dry-run",
			renderer: "headless",
			readiness: {
				status: "blocked",
				label: 'Blocked: host action "missing-action" is not available',
			},
			availableActions: [{ id: "open-node" }],
		});
		expect(output).not.toHaveProperty("selection");
		expect(output).not.toHaveProperty("actionRequest");
		expect(mockShutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("rejects --action-request with human output flags", async () => {
		await expect(
			headlessCommand.parseAsync(
				["--action-request", "open-node", "--summary"],
				{
					from: "user",
				},
			),
		).rejects.toThrow(/Choose only one output format/);
		expect(mockResolveStatusPayload).not.toHaveBeenCalled();
	});

	it("delegates summary formatting with --summary", async () => {
		await headlessCommand.parseAsync(["--summary"], { from: "user" });
		expect(mockPrintStatusSummary).toHaveBeenCalledWith(
			expect.objectContaining({ schemaVersion: 1 }),
		);
	});

	it("rejects --markdown and --summary together", async () => {
		await expect(
			headlessCommand.parseAsync(["--markdown", "--summary"], {
				from: "user",
			}),
		).rejects.toThrow(/Choose only one output format/);
		expect(mockResolveStatusPayload).not.toHaveBeenCalled();
	});
});
