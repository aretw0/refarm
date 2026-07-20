/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import type { AgentEventLine } from "../live-telemetry.js";
import { agentActivityRow, mountAgentActivity, replayAgentActivity } from "./agent-activity.js";
import { arrayEventSource, type LiveEventSource } from "@refarm.dev/capability-homestead-surface";

describe("agent-activity (web twin of the TUI agent-watch)", () => {
	it("maps agent:* events to numbered rows", () => {
		expect(agentActivityRow({ event: "agent:prompt:start", ts: 1 }, 0)).toEqual({
			"#": 1,
			event: "agent:prompt:start",
			ts: "1",
		});
		expect(agentActivityRow({ event: "agent:tool:call" }, 1)).toEqual({ "#": 2, event: "agent:tool:call", ts: "" });
	});

	it("grows the table one row per event (hand-driven source)", () => {
		document.body.innerHTML = `<div id="activity"></div>`;
		const container = document.getElementById("activity")!;
		let emit: (e: AgentEventLine) => void = () => {};
		const source: LiveEventSource<AgentEventLine> = {
			subscribe(onEvent) {
				emit = onEvent;
				return () => {};
			},
		};
		mountAgentActivity({ container, source });
		expect(container.querySelectorAll("tbody tr").length).toBe(0);
		emit({ event: "agent:prompt:start", ts: 1 });
		emit({ event: "agent:route:selected", ts: 2 });
		expect(container.querySelectorAll("tbody tr").length).toBe(2);
		expect(container.textContent).toContain("agent:route:selected");
		expect(container.querySelector("caption")?.textContent).toBe("Agent activity — live");
	});

	it("replays a recorded run to completion (offline demo path)", async () => {
		document.body.innerHTML = `<div id="activity2"></div>`;
		const container = document.getElementById("activity2")!;
		const events: AgentEventLine[] = [
			{ event: "agent:prompt:start", ts: 1 },
			{ event: "agent:tool:call", ts: 2 },
			{ event: "agent:response:done", ts: 3 },
		];
		// Wait until arrayEventSource drains (it schedules events on microtasks).
		await new Promise<void>((resolve) => {
			const drained: LiveEventSource<AgentEventLine> = {
				subscribe: (onEvent, onEnd) =>
					arrayEventSource(events).subscribe(onEvent, () => {
						onEnd?.();
						resolve();
					}),
			};
			mountAgentActivity({ container, source: drained });
		});
		expect(container.querySelectorAll("tbody tr").length).toBe(3);
		expect(container.textContent).toContain("agent:response:done");
	});

	it("replayAgentActivity mounts without throwing (smoke)", () => {
		document.body.innerHTML = `<div id="activity3"></div>`;
		const container = document.getElementById("activity3")!;
		const stop = replayAgentActivity(container, [{ event: "agent:prompt:start", ts: 1 }]);
		expect(container.querySelector("table")).not.toBeNull();
		stop();
	});
});
