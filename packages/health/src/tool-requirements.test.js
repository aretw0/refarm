import { describe, expect, it } from "vitest";
import {
	compareVersions,
	explainToolRequirement,
	parseToolVersion,
	readToolRequirements,
	toolRequirementState,
} from "./tool-requirements.js";

describe("readToolRequirements", () => {
	it("reads a node that has declared no tools as an empty requirement", () => {
		expect(readToolRequirements({})).toEqual({ tools: [], malformed: [] });
		expect(readToolRequirements(undefined)).toEqual({ tools: [], malformed: [] });
	});

	it("reads a declared tool, carrying the reason the node depends on it", () => {
		const config = { nodeTools: { gh: { minVersion: "2.40.0", why: "CI handoffs" } } };
		expect(readToolRequirements(config).tools).toEqual([
			{ command: "gh", args: ["--version"], minVersion: "2.40.0", why: "CI handoffs" },
		]);
	});

	it("accepts a tool declared WITHOUT a minimum, where presence is the whole question", () => {
		expect(readToolRequirements({ nodeTools: { rsync: {} } }).tools).toEqual([
			{ command: "rsync", args: ["--version"], minVersion: undefined, why: undefined },
		]);
	});

	it("REPORTS a malformed entry rather than dropping it", () => {
		// A typo'd entry that vanishes leaves the operator believing a tool is guarded when nothing
		// checks it. Silence here is the failure mode; the entry must surface as broken.
		const result = readToolRequirements({
			nodeTools: { gh: {}, rsync: "3.2.7", cargo: null, jq: ["--version"] },
		});
		expect(result.tools.map((t) => t.command)).toEqual(["gh"]);
		expect(result.malformed).toHaveLength(3);
	});

	it("reads an ARRAY as malformed, because a catalog block is keyed", () => {
		// The shape matters beyond taste: planCatalogDeclaration refuses a block that is not a
		// record, so an array here would be a declaration no guided command could ever write.
		const result = readToolRequirements({ nodeTools: [{ command: "gh" }] });
		expect(result.tools).toEqual([]);
		expect(result.malformed).toHaveLength(1);
	});

	it("keys the entry by COMMAND, so one binary cannot be declared twice", () => {
		const result = readToolRequirements({ nodeTools: { gh: { minVersion: "2.40.0" } } });
		expect(result.tools).toHaveLength(1);
		expect(result.tools[0].command).toBe("gh");
	});
});

describe("parseToolVersion", () => {
	it("reads the version out of the shapes real tools actually print", () => {
		expect(parseToolVersion("gh version 2.4.0 (2022-03-30)")).toBe("2.4.0");
		expect(parseToolVersion("v22.11.0")).toBe("22.11.0");
		expect(parseToolVersion("cargo 1.83.0 (5ffbef321 2024-10-29)")).toBe("1.83.0");
		expect(parseToolVersion("10.15.1")).toBe("10.15.1");
		expect(parseToolVersion("Python 3.11.2")).toBe("3.11.2");
		// Measured on the operator's node 2026-08-17. The distro suffix and the trailing rebuild of
		// the same number are both after the version, and both must be ignored rather than joined.
		expect(parseToolVersion("gh version 2.4.0+dfsg1 (2022-03-23 Ubuntu 2.4.0+dfsg1-2)")).toBe("2.4.0");
	});

	it("reads every banner this node actually prints", () => {
		// Measured 2026-08-18 across the operator's real node, not invented. Each separator here is
		// a different shape: `jq-1.6` uses a DASH, `gpg (GnuPG) 2.2.27` puts a parenthesised name
		// first, `rsync` doubles its spaces, and `gh` appends a distro suffix. A parser tested only
		// against tidy strings passes and then returns `cannot-say` on half a real machine.
		const measured = [
			["v22.19.0", "22.19.0"],
			["11.7.0", "11.7.0"],
			["git version 2.34.1", "2.34.1"],
			["gh version 2.4.0+dfsg1 (2022-03-23 Ubuntu 2.4.0+dfsg1-2)", "2.4.0"],
			["cargo 1.96.1 (356927216 2026-06-26)", "1.96.1"],
			["rustc 1.96.1 (31fca3adb 2026-06-26)", "1.96.1"],
			["rsync  version 3.2.7  protocol version 31", "3.2.7"],
			["jq-1.6", "1.6"],
			["Docker version 28.1.1, build 4eba377", "28.1.1"],
			["gpg (GnuPG) 2.2.27", "2.2.27"],
		];
		for (const [banner, expected] of measured) {
			expect(parseToolVersion(banner), banner).toBe(expected);
		}
	});

	it("does not mistake a DATE for a version", () => {
		// `2022-03-30` has no dot and must never be read as version 2022. A tool whose banner leads
		// with a date would otherwise report a version from the future of every real minimum.
		expect(parseToolVersion("built 2022-03-30")).toBeUndefined();
	});

	it("says nothing when there is no version to read, rather than guessing", () => {
		expect(parseToolVersion("")).toBeUndefined();
		expect(parseToolVersion("command not found")).toBeUndefined();
		expect(parseToolVersion(undefined)).toBeUndefined();
	});
});

describe("compareVersions", () => {
	it("orders by numeric segment, not lexically", () => {
		// The lexical trap: "2.10.0" < "2.9.0" as strings. A gate that sorts text refuses the newer
		// tool and accepts the older one.
		expect(compareVersions("2.10.0", "2.9.0")).toBe(1);
		expect(compareVersions("2.9.0", "2.10.0")).toBe(-1);
		expect(compareVersions("2.4.0", "2.4.0")).toBe(0);
	});

	it("treats a missing segment as zero, so 2.4 and 2.4.0 are the same version", () => {
		expect(compareVersions("2.4", "2.4.0")).toBe(0);
		expect(compareVersions("2.4.1", "2.4")).toBe(1);
	});
});

describe("toolRequirementState", () => {
	it("is ABSENT when the command did not run, whatever the minimum said", () => {
		expect(toolRequirementState({ present: false, minVersion: "2.40.0" })).toBe("absent");
		expect(toolRequirementState({ present: false })).toBe("absent");
	});

	it("is OK when presence was the whole question", () => {
		expect(toolRequirementState({ present: true, versionText: "anything" })).toBe("ok");
		expect(toolRequirementState({ present: true, versionText: undefined })).toBe("ok");
	});

	it("is OUTDATED when the node measured older than it declared", () => {
		expect(
			toolRequirementState({ present: true, versionText: "gh version 2.4.0 (2022-03-30)", minVersion: "2.40.0" }),
		).toBe("outdated");
	});

	it("is OK at exactly the declared minimum, which is a floor and not a bar to clear", () => {
		expect(toolRequirementState({ present: true, versionText: "gh version 2.40.0", minVersion: "2.40.0" })).toBe("ok");
	});

	it("is CANNOT-SAY when a minimum was declared and the version could not be read", () => {
		// The load-bearing state. Reporting `ok` here is reporting success on a claim nothing
		// verified, which is precisely how a node comes to trust a tool it never measured.
		expect(toolRequirementState({ present: true, versionText: "some banner", minVersion: "2.40.0" })).toBe(
			"cannot-say",
		);
	});
});

describe("explainToolRequirement", () => {
	it("says NOTHING when the requirement is satisfied", () => {
		expect(explainToolRequirement({ command: "gh" }, "ok", "2.40.0")).toBeNull();
	});

	it("names BOTH versions when outdated, because the gap is the actionable part", () => {
		const text = explainToolRequirement({ command: "gh", minVersion: "2.40.0" }, "outdated", "2.4.0");
		expect(text).toContain("2.4.0");
		expect(text).toContain("2.40.0");
	});

	it("carries the declared reason, so an operator knows what breaks without it", () => {
		const text = explainToolRequirement({ command: "gh", why: "CI handoffs" }, "absent", undefined);
		expect(text).toContain("CI handoffs");
	});

	it("does not name a fix command, leaving the handoff to the surface that renders it", () => {
		// Same brand guard the model-account contract carries: a generic package naming one CLI's
		// verb cannot be reused by another surface.
		expect(explainToolRequirement({ command: "gh", minVersion: "2.40.0" }, "cannot-say", undefined)).not.toMatch(
			/refarm /u,
		);
	});
});
