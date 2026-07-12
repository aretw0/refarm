import { ActivitySink, withActivity } from "@refarm.dev/capabilities";
import { describe, expect, it } from "vitest";

import { renderActivityOnCli } from "./activity-cli.js";

/** A fake non-TTY write stream that records everything written — so the renderer
 * degrades to printed lines (no ANSI cursor codes) and we can assert on the text. */
function fakeStream(): NodeJS.WriteStream & { written: string[] } {
	const written: string[] = [];
	const stream = {
		isTTY: false,
		write(chunk: string) {
			written.push(chunk);
			return true;
		},
		written,
	};
	return stream as unknown as NodeJS.WriteStream & { written: string[] };
}

describe("renderActivityOnCli", () => {
	it("shows the label when work starts and clears when it finishes", () => {
		const sink = new ActivitySink();
		const stream = fakeStream();
		const handle = renderActivityOnCli({ sink, stream });

		sink.emit({ activityRef: "r1", phase: "started", label: "Signing in to Codex", kind: "auth" });
		expect(stream.written.join("")).toContain("Signing in to Codex");

		sink.emit({ activityRef: "r1", phase: "finished", label: "Signing in to Codex", kind: "auth", ok: true });
		handle.stop();
		// The renderer subscribed and reacted to the whole lifecycle.
		expect(sink.listenerCount).toBe(0);
	});

	it("reflects progress notes on the active line", () => {
		const sink = new ActivitySink();
		const stream = fakeStream();
		const handle = renderActivityOnCli({ sink, stream });

		sink.emit({ activityRef: "r", phase: "started", label: "Sowing", kind: "auth" });
		sink.emit({ activityRef: "r", phase: "progress", label: "Sowing", kind: "auth", note: "verifying GitHub access" });

		const out = stream.written.join("");
		expect(out).toContain("Sowing — verifying GitHub access");

		sink.emit({ activityRef: "r", phase: "finished", label: "Sowing", kind: "auth", ok: true });
		handle.stop();
	});

	it("drives end-to-end from withActivity (emit → sink → render)", async () => {
		const sink = new ActivitySink();
		const stream = fakeStream();
		const handle = renderActivityOnCli({ sink, stream });

		await withActivity(
			"Cloning repo",
			async (report) => {
				report("fetching objects");
				return "ok";
			},
			{ kind: "git", sink },
		);

		const out = stream.written.join("");
		expect(out).toContain("Cloning repo");
		expect(out).toContain("fetching objects");
		handle.stop();
	});

	it("falls back to the parent activity when a nested one finishes", () => {
		const sink = new ActivitySink();
		const stream = fakeStream();
		const handle = renderActivityOnCli({ sink, stream });

		sink.emit({ activityRef: "outer", phase: "started", label: "Outer work", kind: "task" });
		sink.emit({ activityRef: "inner", phase: "started", label: "Inner step", kind: "task" });
		// Inner is on screen now.
		expect(stream.written.at(-1)).toContain("Inner step");

		sink.emit({ activityRef: "inner", phase: "finished", label: "Inner step", kind: "task", ok: true });
		// The parent's label returns to the line.
		expect(stream.written.at(-1)).toContain("Outer work");

		sink.emit({ activityRef: "outer", phase: "finished", label: "Outer work", kind: "task", ok: true });
		handle.stop();
	});

	it("stops rendering after stop() — later events are ignored", () => {
		const sink = new ActivitySink();
		const stream = fakeStream();
		const handle = renderActivityOnCli({ sink, stream });
		handle.stop();

		const before = stream.written.length;
		sink.emit({ activityRef: "r", phase: "started", label: "too late", kind: "task" });
		expect(stream.written.length).toBe(before);
		expect(sink.listenerCount).toBe(0);
	});
});
