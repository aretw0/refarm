import { readCompleteness } from "@refarm.dev/sidecar-client";
import { describe, expect, it } from "vitest";

import { liveEffortIdsFromBody, taskPageFromBody } from "./tasks.js";

/**
 * `GET /tasks` gained `stored`/`truncated`/`offset` and LOST `total` when ISS-041 was fixed.
 * These pin the reading side of that change — in particular the case a live network cannot
 * produce on demand: a node still running a build from before the fix.
 */
describe("taskPageFromBody", () => {
	it("reads a page that reports its completeness", () => {
		const page = taskPageFromBody({
			tasks: [{ "@id": "urn:task:a" }] as never,
			stored: 9,
			truncated: true,
			offset: 4,
		});
		expect(page).toMatchObject({ stored: 9, truncated: true, offset: 4 });
		expect(readCompleteness(page)).toBe("partial");
	});

	it("keeps an older sidecar's silence as silence", () => {
		// The live path for any node built before the fix: no `stored`, no `truncated`. Rounding
		// either to a value would assert a measurement nobody made.
		const page = taskPageFromBody({ tasks: [{ "@id": "urn:task:a" }] as never });
		expect(page.stored).toBeUndefined();
		expect(page.truncated).toBeUndefined();
		expect(readCompleteness(page)).toBe("unknown");
	});

	it("defaults ONLY offset, because offset is the caller's own parameter coming back", () => {
		// The asymmetry is the point. `stored` and `truncated` are measurements the node either
		// made or did not; `offset` is what the request asked for, and a request that sent none
		// asked to start at 0.
		expect(taskPageFromBody({}).offset).toBe(0);
		expect(taskPageFromBody({}).stored).toBeUndefined();
	});

	it("separates an empty page from an unreadable one", () => {
		// Both carry zero tasks. Only one of them means "there are no tasks", which is why the
		// human output prints a different sentence for each.
		expect(readCompleteness(taskPageFromBody({ tasks: [], truncated: false }))).toBe("complete");
		expect(readCompleteness(taskPageFromBody({ tasks: [] }))).toBe("unknown");
	});

	it("survives a body whose tasks key is missing or not an array", () => {
		expect(taskPageFromBody({}).tasks).toEqual([]);
		expect(taskPageFromBody({ tasks: "nope" as never }).tasks).toEqual([]);
	});
});

describe("liveEffortIds — asking the daemon what it still owns", () => {
	/**
	 * MEASURED 2026-08-23. `GET /tasks` reported `stored: 82` while `GET /efforts` reported `[]`,
	 * and one of those 82 had been `active` since 2026-08-03 — twenty days, through a reboot.
	 * `refarm tasks` rendered it identically to a task running right now, because a stored status
	 * says what the record CLAIMS and only the live set says what anything is actually doing.
	 *
	 * NULL IS NOT EMPTY. A daemon that could not be asked must not read as a daemon that owns
	 * nothing — the second would condemn every non-terminal task on the node.
	 */
	it("reads the ids the sidecar reports as live", () => {
		expect(liveEffortIdsFromBody([{ effortId: "urn:a" }, { effortId: "urn:b" }])).toEqual([
			"urn:a",
			"urn:b",
		]);
	});

	it("accepts either shape the effort list has used, and drops what carries neither", () => {
		expect(liveEffortIdsFromBody([{ id: "urn:a" }, { effortId: "urn:b" }, { note: "x" }])).toEqual([
			"urn:a",
			"urn:b",
		]);
	});

	it("says NULL when the body is not a list, rather than calling it empty", () => {
		expect(liveEffortIdsFromBody(null)).toBeNull();
		expect(liveEffortIdsFromBody({ efforts: [] })).toBeNull();
		expect(liveEffortIdsFromBody("[]")).toBeNull();
	});
});
