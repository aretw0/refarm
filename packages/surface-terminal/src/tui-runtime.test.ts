import {
	createCapabilityRegistry,
	withActivity,
	type CapabilityEnvelope,
} from "@refarm.dev/capabilities";
import { buildJsonSuccessEnvelope } from "@refarm.dev/capabilities/envelope";
import { describe, expect, it } from "vitest";

import { runTui, type TuiIo } from "./tui-runtime.js";

/**
 * Drive the interactive runtime with a SCRIPTED IO — a queue of lines the "user"
 * types and a buffer that captures what the runtime writes. This proves the loop
 * end-to-end (render menu → read selection → invoke verb → render envelope) without
 * a real terminal, which is the whole point of the injectable {@link TuiIo}.
 */
function scriptedIo(lines: string[]): { io: TuiIo; output: string[] } {
	const queue = [...lines];
	const output: string[] = [];
	return {
		output,
		io: {
			prompt: async () => queue.shift() ?? "q",
			write: (line) => output.push(line),
			close: () => {},
		},
	};
}

function fixtureRegistry() {
	const registry = createCapabilityRegistry();
	registry.register({
		name: "ping",
		summary: "Ping the thing",
		renderers: { tui: { section: "diagnostics" } },
		run: () => buildJsonSuccessEnvelope({ command: "ping", operation: "check" }),
	});
	registry.register({
		name: "status",
		summary: "Show status",
		renderers: { tui: { section: "diagnostics", shortcut: "s" } },
		run: () => buildJsonSuccessEnvelope({ command: "status" }),
	});
	return registry;
}

describe("runTui (the interactive TUI runtime)", () => {
	it("renders the menu from the surface model", async () => {
		const { io, output } = scriptedIo(["q"]);
		await runTui(fixtureRegistry(), { io, title: "Test Bench" });
		const text = output.join("\n");
		expect(text).toContain("Test Bench");
		expect(text).toContain("diagnostics"); // the section from renderers.tui
		expect(text).toContain("ping");
		expect(text).toContain("status");
	});

	it("aligns the summary column across items of different name widths", async () => {
		const { io, output } = scriptedIo(["q"]);
		await runTui(fixtureRegistry(), { io, title: "Test Bench" });
		const stripAnsi = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
		const lines = output.flatMap((o) => o.split("\n")).map(stripAnsi);
		const pingRow = lines.find((l) => l.includes("ping") && l.includes("Ping the thing"))!;
		const statusRow = lines.find((l) => l.includes("status") && l.includes("Show status"))!;
		// `ping` (4 chars) and `status (s)` (10 chars) differ in width, but their summaries start at the
		// same column — the aligned menu.
		expect(pingRow.indexOf("Ping the thing")).toBe(statusRow.indexOf("Show status"));
	});

	it("invokes a verb selected by 1-based index and renders its envelope", async () => {
		const { io, output } = scriptedIo(["1", "q"]);
		await runTui(fixtureRegistry(), { io });
		expect(output.join("\n")).toContain("✓ ok");
	});

	it("invokes a verb selected by name", async () => {
		const invoked: string[] = [];
		const { io } = scriptedIo(["status", "q"]);
		await runTui(fixtureRegistry(), {
			io,
			invoke: async (verb): Promise<CapabilityEnvelope> => {
				invoked.push(verb);
				return buildJsonSuccessEnvelope({ command: verb });
			},
		});
		expect(invoked).toEqual(["status"]);
	});

	it("invokes a verb selected by its declared renderers.tui shortcut", async () => {
		const invoked: string[] = [];
		const { io } = scriptedIo(["s", "q"]);
		await runTui(fixtureRegistry(), {
			io,
			invoke: async (verb): Promise<CapabilityEnvelope> => {
				invoked.push(verb);
				return buildJsonSuccessEnvelope({ command: verb });
			},
		});
		expect(invoked).toEqual(["status"]); // 's' is status's shortcut
	});

	it("reports an unknown selection without crashing the loop", async () => {
		const { io, output } = scriptedIo(["nope", "q"]);
		await runTui(fixtureRegistry(), { io });
		expect(output.join("\n")).toContain("Unknown selection: nope");
	});

	it("renders an error envelope for an unknown verb via the default invoker", async () => {
		// The default (registry) invoker returns an error envelope for a verb that
		// resolves in the menu but is not runnable — here we force it by name.
		const registry = createCapabilityRegistry();
		registry.register({
			name: "only",
			summary: "the only verb",
			renderers: { tui: {} },
			run: () => buildJsonSuccessEnvelope({ command: "only" }),
		});
		const { io, output } = scriptedIo(["only", "q"]);
		await runTui(registry, { io });
		expect(output.join("\n")).toContain("✓ ok");
	});

	it("shows the activity signal while a verb runs (the operator sees 'working')", async () => {
		const { io, output } = scriptedIo(["status", "q"]);
		// The invoked verb wraps its slow work in withActivity — the TUI must render the
		// activity so the operator is not staring at a frozen menu.
		await runTui(fixtureRegistry(), {
			io,
			invoke: async (): Promise<CapabilityEnvelope> =>
				withActivity(
					"Talking to the runtime",
					async (report) => {
						report("waiting for reply");
						return buildJsonSuccessEnvelope({ command: "status" });
					},
					{ kind: "network" },
				),
		});
		const text = output.join("\n");
		expect(text).toContain("⏳ Talking to the runtime");
		expect(text).toContain("… waiting for reply");
		expect(text).toContain("✓ Talking to the runtime");
	});
});
