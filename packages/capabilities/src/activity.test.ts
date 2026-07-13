import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	ActivitySink,
	newActivityRef,
	withActivity,
	type ProcessActivity,
} from "./activity.js";

/** The SHARED golden fixture pins the TS encoder against the Rust encoder
 * (tractor/src/telemetry/process_activity.rs): both load this file and must reproduce each
 * case's payload. Loaded via a URL-relative path so it resolves from the source dir. */
const PROCESS_ACTIVITY_FIXTURE = JSON.parse(
	readFileSync(fileURLToPath(new URL("../fixtures/process-activity.json", import.meta.url)), "utf8"),
) as { events: Array<{ case: string; payload: Record<string, unknown> }> };

/** JSON round-trip drops `undefined`-valued keys, matching Rust's omission of absent optional
 * fields (note/fraction) — so the shapes compare apples to apples. */
function wire(event: ProcessActivity): Record<string, unknown> {
	return JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
}

describe("ProcessActivity ⊢ shared cross-language fixture (RS↔TS wire pin)", () => {
	it("the TS encoder reproduces every fixture case (no drift from the Rust encoder)", async () => {
		const byCase = new Map<string, ProcessActivity>();
		const sink = new ActivitySink();
		const seen: ProcessActivity[] = [];
		sink.subscribe((e) => seen.push(e));

		// Drive withActivity for real: started → progress(full) → finished(ok).
		await withActivity("Agent responding", (report) => report("step 2", 0.5), {
			kind: "agent",
			sink,
			activityRef: "a-1",
		});
		// And a failing run for finished(ok:false).
		await withActivity(
			"Agent responding",
			() => {
				throw new Error("boom");
			},
			{ kind: "agent", sink, activityRef: "a-1" },
		).catch(() => {});

		for (const e of seen) {
			if (e.phase === "started") byCase.set("started", e);
			if (e.phase === "progress") byCase.set("progress-full", e);
			if (e.phase === "finished") byCase.set(e.ok ? "finished-ok" : "finished-failed", e);
		}
		// `progress-minimal` (no note/fraction) is emittable by the Rust encoder but not by TS
		// withActivity (report always carries a note) — construct it to pin the SHAPE both sides
		// agree on, even though only Rust reaches it today.
		byCase.set("progress-minimal", { activityRef: "a-1", phase: "progress", label: "Agent responding", kind: "agent" });

		for (const { case: caseName, payload } of PROCESS_ACTIVITY_FIXTURE.events) {
			const event = byCase.get(caseName);
			expect(event, `missing TS event for fixture case ${caseName}`).toBeDefined();
			expect(wire(event!), `process-activity fixture case ${caseName} drifted`).toEqual(payload);
		}
	});
});

describe("ActivitySink", () => {
	it("fans out events to every subscriber", () => {
		const sink = new ActivitySink();
		const a: ProcessActivity[] = [];
		const b: ProcessActivity[] = [];
		sink.subscribe((e) => a.push(e));
		sink.subscribe((e) => b.push(e));

		const event: ProcessActivity = { activityRef: "r", phase: "started", label: "L", kind: "auth" };
		sink.emit(event);

		expect(a).toEqual([event]);
		expect(b).toEqual([event]);
	});

	it("stops delivering after unsubscribe", () => {
		const sink = new ActivitySink();
		const seen: ProcessActivity[] = [];
		const unsub = sink.subscribe((e) => seen.push(e));
		sink.emit({ activityRef: "1", phase: "started", label: "x", kind: "task" });
		unsub();
		sink.emit({ activityRef: "2", phase: "started", label: "y", kind: "task" });
		expect(seen.map((e) => e.activityRef)).toEqual(["1"]);
		expect(sink.listenerCount).toBe(0);
	});

	it("isolates a throwing subscriber so the others still receive the event", () => {
		const sink = new ActivitySink();
		const good: ProcessActivity[] = [];
		sink.subscribe(() => {
			throw new Error("broken renderer");
		});
		sink.subscribe((e) => good.push(e));
		// Must not throw, and the good subscriber still gets it.
		expect(() =>
			sink.emit({ activityRef: "r", phase: "started", label: "L", kind: "task" }),
		).not.toThrow();
		expect(good).toHaveLength(1);
	});
});

describe("newActivityRef", () => {
	it("mints unique refs", () => {
		const refs = new Set(Array.from({ length: 50 }, () => newActivityRef()));
		expect(refs.size).toBe(50);
	});
});

describe("withActivity", () => {
	it("emits started then finished{ok:true} around a successful body, returning its value", async () => {
		const sink = new ActivitySink();
		const events: ProcessActivity[] = [];
		sink.subscribe((e) => events.push(e));

		const result = await withActivity("Signing in", async () => "done", { kind: "auth", sink });

		expect(result).toBe("done");
		expect(events.map((e) => e.phase)).toEqual(["started", "finished"]);
		expect(events[0]).toMatchObject({ phase: "started", label: "Signing in", kind: "auth" });
		expect(events[1]).toMatchObject({ phase: "finished", ok: true });
		// started + finished share one activityRef (they correlate).
		expect(events[0]!.activityRef).toBe(events[1]!.activityRef);
	});

	it("emits finished{ok:false} AND rethrows when the body throws (no stuck spinner)", async () => {
		const sink = new ActivitySink();
		const events: ProcessActivity[] = [];
		sink.subscribe((e) => events.push(e));

		await expect(
			withActivity("Cloning", async () => {
				throw new Error("network down");
			}, { kind: "git", sink }),
		).rejects.toThrow("network down");

		expect(events.map((e) => e.phase)).toEqual(["started", "finished"]);
		expect(events[1]).toMatchObject({ phase: "finished", ok: false });
	});

	it("forwards optional progress reports with note and fraction", async () => {
		const sink = new ActivitySink();
		const events: ProcessActivity[] = [];
		sink.subscribe((e) => events.push(e));

		await withActivity(
			"Agent responding",
			async (report) => {
				report("iterating");
				report("uploading", 0.5);
			},
			{ kind: "agent", sink },
		);

		expect(events.map((e) => e.phase)).toEqual(["started", "progress", "progress", "finished"]);
		expect(events[1]).toMatchObject({ phase: "progress", note: "iterating", kind: "agent" });
		expect(events[2]).toMatchObject({ phase: "progress", note: "uploading", fraction: 0.5 });
		// All four events share the one activityRef.
		const refs = new Set(events.map((e) => e.activityRef));
		expect(refs.size).toBe(1);
	});

	it("honors a caller-supplied activityRef (to correlate with an existing ref)", async () => {
		const sink = new ActivitySink();
		const events: ProcessActivity[] = [];
		sink.subscribe((e) => events.push(e));
		await withActivity("x", async () => {}, { sink, activityRef: "prompt-42" });
		expect(events.every((e) => e.activityRef === "prompt-42")).toBe(true);
	});

	it("defaults kind to 'task' when omitted", async () => {
		const sink = new ActivitySink();
		const events: ProcessActivity[] = [];
		sink.subscribe((e) => events.push(e));
		await withActivity("some work", async () => {}, { sink });
		expect(events[0]!.kind).toBe("task");
	});
});
