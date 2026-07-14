import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { awaitAuditLine, readAuditLines } from "./live-runtime.js";

/** Write NDJSON lines to a temp refarmDir's scarecrow-audit.ndjson, as the host would. */
function writeTrail(lines: Array<Record<string, unknown>>): string {
	const dir = mkdtempSync(join(tmpdir(), "t1-trail-"));
	writeFileSync(join(dir, "scarecrow-audit.ndjson"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
	return dir;
}

describe("readAuditLines — both families, unfiltered", () => {
	it("reads host-effect:* AND agent:* lines from the one file", () => {
		const dir = writeTrail([
			{ ts: 1, event: "agent:prompt:start", prompt_ref: "p1" },
			{ ts: 2, event: "host-effect:fs:read", plugin_id: "agent", path: "/x" },
			{ ts: 3, event: "agent:response:done", prompt_ref: "p1", tokens_out: 5 },
		]);
		const lines = readAuditLines(dir);
		expect(lines.map((l) => l.event)).toEqual(["agent:prompt:start", "host-effect:fs:read", "agent:response:done"]);
	});

	it("returns [] when the trail file is absent (no crash)", () => {
		expect(readAuditLines(mkdtempSync(join(tmpdir(), "t1-empty-")))).toEqual([]);
	});

	it("skips malformed lines", () => {
		const dir = mkdtempSync(join(tmpdir(), "t1-bad-"));
		writeFileSync(join(dir, "scarecrow-audit.ndjson"), '{"ts":1,"event":"agent:x"}\nnot json\n{"ts":2,"event":"host-effect:y"}\n');
		expect(readAuditLines(dir).map((l) => l.event)).toEqual(["agent:x", "host-effect:y"]);
	});
});

describe("awaitAuditLine — poll instead of sleep", () => {
	it("returns the matching line when present (fast path)", async () => {
		const dir = writeTrail([{ ts: 1, event: "host-effect:fs:read" }]);
		const line = await awaitAuditLine(dir, (l) => l.event === "host-effect:fs:read", 1000);
		expect(line?.event).toBe("host-effect:fs:read");
	});

	it("times out (returns undefined) when the line never appears — the DENIED posture", async () => {
		const dir = writeTrail([{ ts: 1, event: "agent:prompt:start" }]);
		const start = Date.now();
		const line = await awaitAuditLine(dir, (l) => l.event === "host-effect:fs:read", 400);
		expect(line).toBeUndefined();
		// It waited out the (short) deadline, not longer.
		expect(Date.now() - start).toBeGreaterThanOrEqual(350);
	});

	it("picks up a line that appears AFTER the first poll (the flush race the sleep raced)", async () => {
		const dir = writeTrail([{ ts: 1, event: "agent:prompt:start" }]);
		// Append the terminal line shortly after the poll begins.
		setTimeout(() => {
			writeFileSync(
				join(dir, "scarecrow-audit.ndjson"),
				[{ ts: 1, event: "agent:prompt:start" }, { ts: 2, event: "agent:response:done" }]
					.map((l) => JSON.stringify(l))
					.join("\n") + "\n",
			);
		}, 200);
		const line = await awaitAuditLine(dir, (l) => l.event === "agent:response:done", 2000);
		expect(line?.event).toBe("agent:response:done");
	});
});
