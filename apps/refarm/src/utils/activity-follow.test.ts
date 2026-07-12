import { ActivitySink, type ProcessActivity } from "@refarm.dev/capabilities";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { followActivityFile } from "./activity-follow.js";

/** Append an activity line to the file the daemon would write. */
function appendActivity(dir: string, event: ProcessActivity): void {
	fs.appendFileSync(path.join(dir, "activity.ndjson"), `${JSON.stringify(event)}\n`);
}

/** Poll until `cond` is true or the deadline passes (the follower is interval-driven). */
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!cond()) {
		if (Date.now() > deadline) throw new Error("timed out waiting for condition");
		await new Promise((r) => setTimeout(r, 20));
	}
}

describe("followActivityFile", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-activity-follow-"));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("tails newly-appended activity lines into the sink", async () => {
		const sink = new ActivitySink();
		const seen: ProcessActivity[] = [];
		sink.subscribe((e) => seen.push(e));

		const follower = followActivityFile({ sink, streamsDir: dir, pollIntervalMs: 20 });
		try {
			appendActivity(dir, { activityRef: "e1", phase: "started", label: "Agent responding", kind: "agent" });
			appendActivity(dir, { activityRef: "e1", phase: "finished", label: "Agent responding", kind: "agent", ok: true });

			await waitFor(() => seen.length >= 2);
			expect(seen.map((e) => e.phase)).toEqual(["started", "finished"]);
			expect(seen[0]).toMatchObject({ activityRef: "e1", kind: "agent" });
			expect(seen[1]).toMatchObject({ phase: "finished", ok: true });
		} finally {
			follower.stop();
		}
	});

	it("does NOT replay lines that predate the follower (starts at end of file)", async () => {
		// The daemon's activity file is long-lived; a fresh CLI must not replay old work.
		appendActivity(dir, { activityRef: "old", phase: "started", label: "old work", kind: "task" });

		const sink = new ActivitySink();
		const seen: ProcessActivity[] = [];
		sink.subscribe((e) => seen.push(e));
		const follower = followActivityFile({ sink, streamsDir: dir, pollIntervalMs: 20 });
		try {
			appendActivity(dir, { activityRef: "new", phase: "started", label: "new work", kind: "task" });
			await waitFor(() => seen.some((e) => e.activityRef === "new"));
			expect(seen.some((e) => e.activityRef === "old")).toBe(false);
		} finally {
			follower.stop();
		}
	});

	it("emits each appended line exactly once across polls", async () => {
		const sink = new ActivitySink();
		const seen: ProcessActivity[] = [];
		sink.subscribe((e) => seen.push(e));
		const follower = followActivityFile({ sink, streamsDir: dir, pollIntervalMs: 20 });
		try {
			appendActivity(dir, { activityRef: "a", phase: "started", label: "L", kind: "task" });
			await waitFor(() => seen.length >= 1);
			// Give several more poll cycles — the line must not be re-emitted.
			await new Promise((r) => setTimeout(r, 120));
			expect(seen.filter((e) => e.activityRef === "a")).toHaveLength(1);
		} finally {
			follower.stop();
		}
	});

	it("skips malformed lines without crashing", async () => {
		const sink = new ActivitySink();
		const seen: ProcessActivity[] = [];
		sink.subscribe((e) => seen.push(e));
		const follower = followActivityFile({ sink, streamsDir: dir, pollIntervalMs: 20 });
		try {
			fs.appendFileSync(path.join(dir, "activity.ndjson"), "not json\n");
			fs.appendFileSync(path.join(dir, "activity.ndjson"), `${JSON.stringify({ nope: true })}\n`);
			appendActivity(dir, { activityRef: "good", phase: "started", label: "L", kind: "task" });
			await waitFor(() => seen.some((e) => e.activityRef === "good"));
			// Only the well-formed line came through.
			expect(seen).toHaveLength(1);
		} finally {
			follower.stop();
		}
	});

	it("stops emitting after stop()", async () => {
		const sink = new ActivitySink();
		const seen: ProcessActivity[] = [];
		sink.subscribe((e) => seen.push(e));
		const follower = followActivityFile({ sink, streamsDir: dir, pollIntervalMs: 20 });
		follower.stop();
		appendActivity(dir, { activityRef: "late", phase: "started", label: "L", kind: "task" });
		await new Promise((r) => setTimeout(r, 100));
		expect(seen).toHaveLength(0);
	});
});
