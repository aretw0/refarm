import { describe, expect, it } from "vitest";

import {
	getSource,
	normalizeSurfacePath,
	surfaceActive,
	type PackageSource,
} from "./composition.js";

describe("getSource", () => {
	it("returns a bare-string entry verbatim", () => {
		expect(getSource("npm:@acme/skills")).toBe("npm:@acme/skills");
	});
	it("returns the object entry's source", () => {
		expect(getSource({ source: "../local/pkg", skills: [] })).toBe("../local/pkg");
	});
});

describe("normalizeSurfacePath", () => {
	it("strips a leading ./ and converts backslashes", () => {
		expect(normalizeSurfacePath("./skills/x")).toBe("skills/x");
		expect(normalizeSurfacePath("skills\\x")).toBe("skills/x");
		expect(normalizeSurfacePath(".\\skills\\x")).toBe("skills/x");
	});
});

describe("surfaceActive (ported 1:1 from pi configuredExtensionActive)", () => {
	it("a bare-string entry activates ALL surfaces", () => {
		expect(surfaceActive("@refarm/agent", "skills", "skills/anything")).toBe(true);
		expect(surfaceActive("@refarm/agent", "tools", "tools/anything")).toBe(true);
	});

	it("an object with the surface key ABSENT activates all of that surface", () => {
		const entry: PackageSource = { source: "@refarm/agent", tools: ["!tools/x"] };
		// skills is absent → all skills active (tools suppression is unrelated).
		expect(surfaceActive(entry, "skills", "skills/anything")).toBe(true);
	});

	it("a PRESENT-EMPTY surface array suppresses ALL of that surface", () => {
		const entry: PackageSource = { source: "@refarm/agent", skills: [] };
		expect(surfaceActive(entry, "skills", "skills/a")).toBe(false);
		expect(surfaceActive(entry, "skills", "skills/b")).toBe(false);
		// A DIFFERENT surface (absent) is still all-active — present-empty is scoped.
		expect(surfaceActive(entry, "tools", "tools/a")).toBe(true);
	});

	it("a denylist (!x) suppresses only the named id", () => {
		const entry: PackageSource = {
			source: "npm:@acme/skills",
			skills: ["!skills/legacy"],
		};
		expect(surfaceActive(entry, "skills", "skills/legacy")).toBe(false);
		expect(surfaceActive(entry, "skills", "skills/other")).toBe(true);
	});

	it("an allowlist (bare) activates only the named id", () => {
		const entry: PackageSource = {
			source: "npm:@acme/skills",
			skills: ["skills/only"],
		};
		expect(surfaceActive(entry, "skills", "skills/only")).toBe(true);
		expect(surfaceActive(entry, "skills", "skills/other")).toBe(false);
	});

	it("mixed include+exclude mode-flips to an allowlist (only the included id)", () => {
		// Documents pi's implicit flip: once ANY bare include is present, the array
		// is an allowlist, so a sibling !exclude is redundant but the non-listed ids
		// are all off.
		const entry: PackageSource = {
			source: "npm:@acme/skills",
			skills: ["skills/a", "!skills/b"],
		};
		expect(surfaceActive(entry, "skills", "skills/a")).toBe(true);
		expect(surfaceActive(entry, "skills", "skills/b")).toBe(false);
		expect(surfaceActive(entry, "skills", "skills/c")).toBe(false);
	});

	it("normalizes both pattern and id so ./ and \\ variants still match", () => {
		const entry: PackageSource = {
			source: "npm:@acme/skills",
			skills: ["!skills/x"],
		};
		// The id is authored with a leading ./ — it must still hit the !skills/x deny.
		expect(surfaceActive(entry, "skills", "./skills/x")).toBe(false);
		expect(surfaceActive(entry, "skills", "skills\\x")).toBe(false);
	});
});
