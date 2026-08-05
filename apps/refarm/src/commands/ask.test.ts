import { describe, expect, it } from "vitest";
import { resolveDispatchWorkspace } from "./ask.js";

const ROOTS = [
	{ id: "rcdc5", absolutePath: "/home/op/git/rcdc5" },
	{ id: "refarm", absolutePath: "/home/op/github/refarm" },
];

describe("resolveDispatchWorkspace — the four degrees", () => {
	it("1. an explicit flag wins over everything and is recorded as declared", () => {
		expect(
			resolveDispatchWorkspace({
				flag: "rcdc5",
				sessionWorkspace: { id: "refarm", source: "declared" },
				interactiveCwd: "/home/op/github/refarm",
				roots: ROOTS,
			}),
		).toEqual({ workspaceId: "rcdc5", workspaceSource: "declared" });
	});

	it("2. an established session is inherited, and standing elsewhere does not steal it", () => {
		expect(
			resolveDispatchWorkspace({
				sessionWorkspace: { id: "rcdc5", source: "seeded-from-cwd" },
				interactiveCwd: "/home/op/github/refarm",
				roots: ROOTS,
			}),
		).toEqual({ workspaceId: "rcdc5", workspaceSource: "seeded-from-cwd" });
	});

	it("3. an unattributed session seeds from the operator's directory", () => {
		expect(
			resolveDispatchWorkspace({ interactiveCwd: "/home/op/git/rcdc5/pkg", roots: ROOTS }),
		).toEqual({ workspaceId: "rcdc5", workspaceSource: "seeded-from-cwd" });
	});

	it("4. no flag, no session, no interactive cwd — no workspace, no keys", () => {
		expect(resolveDispatchWorkspace({ roots: ROOTS })).toEqual({});
	});

	it("a caller with no meaningful directory seeds nothing — the node's case", () => {
		expect(
			resolveDispatchWorkspace({ interactiveCwd: undefined, roots: ROOTS }),
		).toEqual({});
	});

	it("standing outside every declared root attributes nothing", () => {
		expect(resolveDispatchWorkspace({ interactiveCwd: "/tmp", roots: ROOTS })).toEqual({});
	});
});
