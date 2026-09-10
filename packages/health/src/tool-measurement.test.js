import { describe, expect, it } from "vitest";

import { describeMeasurement, measureTool, proposedFloor } from "./tool-measurement.js";

/** A spawn that answers for exactly one binary, so a test can never accidentally measure the
 *  machine it runs on — the result would differ per developer and per CI image. */
function fakeSpawn(banners) {
	return (command) => {
		const banner = banners[command];
		if (banner === undefined) return { status: 1, stdout: "", stderr: "not found" };
		return { status: 0, stdout: banner, stderr: "" };
	};
}

const GH = fakeSpawn({ gh: "gh version 2.4.0 (2022-03-30)" });

describe("measureTool", () => {
	it("reads a version out of a tool that ran", () => {
		expect(measureTool("gh", ["--version"], GH)).toEqual({
			kind: "measured",
			version: "2.4.0",
			banner: "gh version 2.4.0 (2022-03-30)",
		});
	});

	it("separates a tool that did not run from one whose banner cannot be read", () => {
		// Two different declarations follow: one you install, one you declare without a floor.
		// A boolean here would send the operator to the wrong repair half the time.
		expect(measureTool("nope", ["--version"], GH).kind).toBe("absent");
		expect(measureTool("gh", ["--version"], fakeSpawn({ gh: "built from source" })).kind).toBe(
			"unreadable",
		);
	});

	it("carries what the failure SAID, not just that there was one", () => {
		const measurement = measureTool("nope", ["--version"], GH);
		expect(measurement.kind === "absent" && measurement.detail).toBe("not found");
	});
});

describe("proposedFloor", () => {
	it("proposes what it measured, and proposes NOTHING when it measured nothing", () => {
		// The line between a draft the operator accepts and an inference nobody decided: the
		// default is a number they were shown. Inventing one for an unreadable banner would be a
		// guess wearing a default.
		expect(proposedFloor({ kind: "measured", version: "2.4.0", banner: "x" })).toBe("2.4.0");
		expect(proposedFloor({ kind: "unreadable", banner: "x" })).toBeNull();
		expect(proposedFloor({ kind: "absent", detail: "x" })).toBeNull();
	});
});

describe("describeMeasurement", () => {
	it("tells an unreadable banner what declaring a minimum against it would cost", () => {
		const text = describeMeasurement("ovpnctl", { kind: "unreadable", banner: "build unknown" });
		expect(text).toMatch(/cannot-say/u);
	});

	it("names no CLI verb, so any surface can render it", () => {
		expect(describeMeasurement("gh", { kind: "absent", detail: "not found" })).not.toMatch(
			/refarm /u,
		);
	});
});
