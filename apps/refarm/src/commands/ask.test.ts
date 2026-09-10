import { describe, expect, it } from "vitest";
import { resolveDispatchWorkspace, validateWorkspaceFlag } from "./ask.js";

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

	it("2b. an inherited DECLARED session keeps its provenance — the ternary must not downgrade it", () => {
		expect(
			resolveDispatchWorkspace({
				sessionWorkspace: { id: "rcdc5", source: "declared" },
				interactiveCwd: "/home/op/github/refarm",
				roots: ROOTS,
			}),
		).toEqual({ workspaceId: "rcdc5", workspaceSource: "declared" });
	});

	it("2c. a read failure ('unknown') is NOT 'not declared' — it must fall through to NO attribution, never to the cwd seed", () => {
		// Fix round 1, CRITICAL: a session that already exists but whose stored
		// declaration could not be read (sidecar timeout, transient non-200) must
		// never be silently re-attributed to wherever the operator is standing.
		// Standing squarely inside a declared root (rcdc5) proves the seed was
		// available and deliberately not used.
		expect(
			resolveDispatchWorkspace({
				sessionWorkspace: "unknown",
				interactiveCwd: "/home/op/git/rcdc5/pkg",
				roots: ROOTS,
			}),
		).toEqual({});
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

describe("validateWorkspaceFlag", () => {
	it("no flag ⇒ nothing to validate, absent means absent", () => {
		expect(validateWorkspaceFlag(undefined, ROOTS)).toEqual({});
	});

	it("a declared id passes through trimmed", () => {
		expect(validateWorkspaceFlag(" rcdc5 ", ROOTS)).toEqual({ workspaceId: "rcdc5" });
	});

	it("a typo that matches no declared workspace is rejected, naming the declared ones", () => {
		const result = validateWorkspaceFlag("rcdc", ROOTS);
		expect("error" in result).toBe(true);
		expect((result as { error: string }).error).toContain('"rcdc"');
		expect((result as { error: string }).error).toContain("rcdc5");
		expect((result as { error: string }).error).toContain("refarm");
	});

	it("an empty flag is rejected", () => {
		expect(validateWorkspaceFlag("   ", ROOTS)).toEqual({
			error: "--workspace must not be empty",
		});
	});

	it("whitespace or a colon in the id is rejected, same rule as parseWorkspaceOption", () => {
		expect("error" in validateWorkspaceFlag("rc dc5", ROOTS)).toBe(true);
		expect("error" in validateWorkspaceFlag("rcdc5:prod", ROOTS)).toBe(true);
	});

	it("no workspaces declared at all names that in the error", () => {
		const result = validateWorkspaceFlag("rcdc5", []);
		expect("error" in result).toBe(true);
		expect((result as { error: string }).error).toContain("(none declared)");
	});
});
