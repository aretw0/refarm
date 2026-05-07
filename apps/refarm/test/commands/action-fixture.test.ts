import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createActionsCommand } from "../../src/commands/actions.js";
import { headlessCommand } from "../../src/commands/headless.js";
import { createTuiCommand } from "../../src/commands/tui.js";
import { createWebCommand } from "../../src/commands/web.js";

const STATUS_WITH_ACTIONS_FIXTURE = fileURLToPath(
	new URL("../fixtures/status-with-actions.json", import.meta.url),
);

describe("status-with-actions fixture", () => {
	it("drives renderer-neutral host action JSON output from --input", async () => {
		const command = createActionsCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["--input", STATUS_WITH_ACTIONS_FIXTURE, "--select", "2", "--json"],
			{ from: "user" },
		);

		const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(output).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "dry-run",
			command: "actions",
			renderer: "headless",
			selection: {
				requested: "2",
				source: "index",
				resolvedId: "inspect-trust",
				index: 2,
			},
			selectedAction: {
				id: "inspect-trust",
				label: "Inspect trust",
				intent: "trust:inspect",
			},
		});
		logSpy.mockRestore();
	});

	it("drives renderer-neutral host action row output from --input", async () => {
		const command = createActionsCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--input", STATUS_WITH_ACTIONS_FIXTURE], {
			from: "user",
		});

		expect(logSpy).toHaveBeenCalledWith(
			[
				"Available host actions:",
				"  [1] Open node — open-node (node:open)",
				"  [2] Inspect trust — inspect-trust (trust:inspect)",
			].join("\n"),
		);
		logSpy.mockRestore();
	});

	it("drives headless dry-run action request output from --input", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await headlessCommand.parseAsync(
			["--input", STATUS_WITH_ACTIONS_FIXTURE, "--action-request", "open-node"],
			{ from: "user" },
		);

		const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(output).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "dry-run",
			selection: {
				requested: "open-node",
				source: "id",
				resolvedId: "open-node",
				index: 1,
			},
			actionRequest: {
				pluginId: "apps/refarm",
				slotId: "headless",
				mountSource: "legacy-ui-slot",
				action: {
					id: "open-node",
					label: "Open node",
					intent: "node:open",
				},
			},
			availableActions: [
				expect.objectContaining({ id: "open-node" }),
				expect.objectContaining({ id: "inspect-trust" }),
			],
		});
		logSpy.mockRestore();
	});

	it("drives headless dry-run action request output from a row index", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await headlessCommand.parseAsync(
			["--input", STATUS_WITH_ACTIONS_FIXTURE, "--action-request", "2"],
			{ from: "user" },
		);

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
			intent: "trust:inspect",
		});
		logSpy.mockRestore();
	});

	it("drives headless blocked action request readiness from --input", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await headlessCommand.parseAsync(
			["--input", STATUS_WITH_ACTIONS_FIXTURE, "--action-request", "missing"],
			{ from: "user" },
		);

		const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(output).toMatchObject({
			reason: "dry-run",
			readiness: {
				status: "blocked",
				label: 'Blocked: host action "missing" is not available',
			},
			availableActions: [
				{ id: "open-node", label: "Open node" },
				{ id: "inspect-trust", label: "Inspect trust" },
			],
		});
		expect(output).not.toHaveProperty("selection");
		expect(output).not.toHaveProperty("actionRequest");
		logSpy.mockRestore();
	});

	it("drives Web selected action JSON output from --input", async () => {
		const command = createWebCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			[
				"--input",
				STATUS_WITH_ACTIONS_FIXTURE,
				"--actions",
				"--select",
				"2",
				"--json",
			],
			{ from: "user" },
		);

		const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(output).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "dry-run",
			renderer: "web",
			selection: {
				requested: "2",
				source: "index",
				resolvedId: "inspect-trust",
				index: 2,
			},
			selectedAction: {
				id: "inspect-trust",
				label: "Inspect trust",
				intent: "trust:inspect",
			},
		});
		logSpy.mockRestore();
	});

	it("drives Web action row output from --input", async () => {
		const command = createWebCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["--input", STATUS_WITH_ACTIONS_FIXTURE, "--actions"],
			{ from: "user" },
		);

		expect(logSpy).toHaveBeenCalledWith(
			[
				"Available Web actions:",
				"  [1] Open node — open-node (node:open)",
				"  [2] Inspect trust — inspect-trust (trust:inspect)",
			].join("\n"),
		);
		logSpy.mockRestore();
	});

	it("drives TUI selected action JSON output from --input", async () => {
		const command = createTuiCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			[
				"--input",
				STATUS_WITH_ACTIONS_FIXTURE,
				"--actions",
				"--select",
				"2",
				"--json",
			],
			{ from: "user" },
		);

		const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(output).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "dry-run",
			renderer: "tui",
			selection: {
				requested: "2",
				source: "index",
				resolvedId: "inspect-trust",
				index: 2,
			},
			selectedAction: {
				id: "inspect-trust",
				label: "Inspect trust",
				intent: "trust:inspect",
			},
		});
		logSpy.mockRestore();
	});

	it("drives TUI selected action output from --input", async () => {
		const command = createTuiCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["--input", STATUS_WITH_ACTIONS_FIXTURE, "--actions", "--select", "2"],
			{ from: "user" },
		);

		expect(logSpy).toHaveBeenCalledWith(
			[
				"Selected TUI action:",
				"  [2] Inspect trust — inspect-trust (trust:inspect)",
				"Selection:",
				"  requested: 2",
				"  resolved: inspect-trust",
				"  source: index",
				"Available TUI actions:",
				"  [1] Open node — open-node (node:open)",
				"  [2] Inspect trust — inspect-trust (trust:inspect)",
			].join("\n"),
		);
		logSpy.mockRestore();
	});

	it("drives TUI action row output from --input", async () => {
		const command = createTuiCommand();
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["--input", STATUS_WITH_ACTIONS_FIXTURE, "--actions"],
			{ from: "user" },
		);

		expect(logSpy).toHaveBeenCalledWith(
			[
				"Available TUI actions:",
				"  [1] Open node — open-node (node:open)",
				"  [2] Inspect trust — inspect-trust (trust:inspect)",
			].join("\n"),
		);
		logSpy.mockRestore();
	});

	it("drives blocked JSON readiness for missing fixture selections", async () => {
		const scenarios = [
			{
				command: createActionsCommand(),
				args: [
					"--input",
					STATUS_WITH_ACTIONS_FIXTURE,
					"--select",
					"missing",
					"--json",
				],
				renderer: "headless",
			},
			{
				command: createWebCommand(),
				args: [
					"--input",
					STATUS_WITH_ACTIONS_FIXTURE,
					"--actions",
					"--select",
					"missing",
					"--json",
				],
				renderer: "web",
			},
			{
				command: createTuiCommand(),
				args: [
					"--input",
					STATUS_WITH_ACTIONS_FIXTURE,
					"--actions",
					"--select",
					"missing",
					"--json",
				],
				renderer: "tui",
			},
		];

		for (const scenario of scenarios) {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			await scenario.command.parseAsync(scenario.args, { from: "user" });

			const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
			expect(output).toMatchObject({
				reason: "dry-run",
				renderer: scenario.renderer,
				readiness: {
					status: "blocked",
					label: 'Blocked: host action "missing" is not available',
				},
				actionRows: [
					{ id: "open-node", index: 1 },
					{ id: "inspect-trust", index: 2 },
				],
			});
			expect(output).not.toHaveProperty("selection");
			expect(output).not.toHaveProperty("selectedAction");
			logSpy.mockRestore();
		}
	});
});
