import { describe, expect, it } from "vitest";
import {
	mountLiveActivityStream,
	parseActivityFrame,
	type EventSourceLike,
} from "../src/sdk/activity-web-live";

describe("parseActivityFrame", () => {
	it("parses a process activity frame (flat event + payload)", () => {
		const a = parseActivityFrame(
			JSON.stringify({ event: "process:started", activityRef: "r1", phase: "started", label: "Agent turn", kind: "agent" }),
		);
		expect(a).toEqual({ event: "process:started", activityRef: "r1", phase: "started", label: "Agent turn", kind: "agent" });
	});

	it("skips agent:* frames that carry no phase (pills render process-shaped only)", () => {
		expect(parseActivityFrame(JSON.stringify({ event: "agent:route:selected", prompt_ref: "p", provider: "ollama" }))).toBeNull();
	});

	it("returns null on malformed data", () => {
		expect(parseActivityFrame("not json")).toBeNull();
	});
});

/** A controllable fake EventSource for headless testing. */
class FakeEventSource implements EventSourceLike {
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	closed = false;
	emit(data: string) {
		this.onmessage?.({ data });
	}
	close() {
		this.closed = true;
	}
}

describe("mountLiveActivityStream", () => {
	it("renders live pills as activity frames arrive and prunes finished ones", () => {
		const mount = { innerHTML: "" };
		const fake = new FakeEventSource();
		const handle = mountLiveActivityStream(mount, { eventSourceFactory: () => fake });

		fake.emit(JSON.stringify({ activityRef: "r1", phase: "started", label: "Agent turn", kind: "agent" }));
		expect(mount.innerHTML).toContain("Agent turn");
		expect(mount.innerHTML).toContain("working…");

		fake.emit(JSON.stringify({ activityRef: "r1", phase: "progress", label: "Agent turn", kind: "agent", note: "route ollama" }));
		expect(mount.innerHTML).toContain("route ollama");

		fake.emit(JSON.stringify({ activityRef: "r1", phase: "finished", label: "Agent turn", kind: "agent", ok: true }));
		// Finished → no live pill.
		expect(mount.innerHTML).toBe("");

		handle.stop();
		expect(fake.closed).toBe(true);
	});

	it("ignores non-activity frames without breaking the render", () => {
		const mount = { innerHTML: "seed" };
		const fake = new FakeEventSource();
		mountLiveActivityStream(mount, { eventSourceFactory: () => fake });
		fake.emit(JSON.stringify({ event: "agent:iteration", prompt_ref: "p" })); // no phase after server fold? skipped
		fake.emit("garbage");
		// No activity frame arrived, so the mount was never re-rendered from an activity.
		expect(mount.innerHTML).toBe("seed");
	});
});
