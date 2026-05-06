import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { headlessCommand } from "../../src/commands/headless.js";
import { createTuiCommand } from "../../src/commands/tui.js";

const STATUS_WITH_ACTIONS_FIXTURE = fileURLToPath(
	new URL("../fixtures/status-with-actions.json", import.meta.url),
);

describe("status-with-actions fixture", () => {
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
});
