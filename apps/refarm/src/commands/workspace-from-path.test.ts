import { describe, expect, it } from "vitest";
import { type DeclaredRoot, resolveWorkspaceFromPath } from "./workspace-from-path.js";

const ROOTS: DeclaredRoot[] = [
	{ id: "rcdc5", absolutePath: "/home/op/git/rcdc5/rcdc5" },
	{ id: "refarm", absolutePath: "/home/op/github/refarm" },
];

describe("resolveWorkspaceFromPath", () => {
	it("resolves a path inside a declared root", () => {
		expect(resolveWorkspaceFromPath("/home/op/github/refarm/apps", ROOTS)).toBe("refarm");
	});

	it("resolves the root itself", () => {
		expect(resolveWorkspaceFromPath("/home/op/github/refarm", ROOTS)).toBe("refarm");
	});

	it("returns undefined outside every declared root — never a nearest match", () => {
		expect(resolveWorkspaceFromPath("/home/op/elsewhere", ROOTS)).toBeUndefined();
	});

	it("returns undefined when nothing is declared", () => {
		expect(resolveWorkspaceFromPath("/home/op/github/refarm", [])).toBeUndefined();
	});

	it("longest matching prefix wins for nested roots", () => {
		const nested: DeclaredRoot[] = [
			{ id: "outer", absolutePath: "/home/op/git" },
			{ id: "inner", absolutePath: "/home/op/git/rcdc5" },
		];
		expect(resolveWorkspaceFromPath("/home/op/git/rcdc5/pkg", nested)).toBe("inner");
		expect(resolveWorkspaceFromPath("/home/op/git/other", nested)).toBe("outer");
	});

	it("a shared string prefix is not containment — the boundary must be a separator", () => {
		expect(resolveWorkspaceFromPath("/home/op/github/refarm-old", ROOTS)).toBeUndefined();
	});

	it("normalises traversal before comparing", () => {
		expect(resolveWorkspaceFromPath("/home/op/github/refarm/apps/..", ROOTS)).toBe("refarm");
	});

	it("a relative candidate path resolves nothing — callers pass absolute paths", () => {
		expect(resolveWorkspaceFromPath("apps/refarm", ROOTS)).toBeUndefined();
	});
});
