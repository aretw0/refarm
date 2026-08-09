import { resolveWorkspaceLedger } from "@refarm.dev/cli";
import { describe, expect, it } from "vitest";

const CATALOG = [
	{ id: "refarm", absolutePath: "/home/op/github/refarm", issues: { provider: "project-json", path: ".project/issues.json" } },
	{ id: "rcdc5", absolutePath: "/home/op/git/rcdc5/rcdc5", issues: null },
];

const deps = {
	loadWorkspaces: () => CATALOG,
	fileExists: (p: string) => p === "/home/op/git/rcdc5/rcdc5/.project/issues.json",
	readDocument: () => JSON.stringify({ issues: [] }),
	writeDocument: () => {},
};

describe("resolveWorkspaceLedger", () => {
	it("resolves from the flag and says so", () => {
		const result = resolveWorkspaceLedger({ workspace: "refarm", cwd: "/tmp", ...deps });
		expect(result).toMatchObject({ ok: true, workspaceId: "refarm", resolvedFrom: "flag" });
	});

	it("gives the same answer from any directory", () => {
		const a = resolveWorkspaceLedger({ workspace: "refarm", cwd: "/tmp", ...deps });
		const b = resolveWorkspaceLedger({ workspace: "refarm", cwd: "/home/op/git/rcdc5/rcdc5", ...deps });
		expect(a).toEqual(b);
	});

	it("matches cwd against the catalog and declares the inference", () => {
		const result = resolveWorkspaceLedger({ cwd: "/home/op/github/refarm/docs", ...deps });
		expect(result).toMatchObject({ ok: true, workspaceId: "refarm", resolvedFrom: "cwd-match" });
	});

	it("infers project-json by convention when undeclared but present, and says so", () => {
		const result = resolveWorkspaceLedger({ workspace: "rcdc5", cwd: "/tmp", ...deps });
		expect(result).toMatchObject({ ok: true, provider: "project-json", resolvedFrom: "convention" });
	});

	it("refuses an unmatched cwd and lists the declared workspaces — never reads ./.project", () => {
		const result = resolveWorkspaceLedger({ cwd: "/tmp", ...deps });
		expect(result).toMatchObject({ ok: false, reason: "cwd_unmatched", declared: ["refarm", "rcdc5"] });
	});

	it("refuses an unknown workspace id", () => {
		const result = resolveWorkspaceLedger({ workspace: "nope", cwd: "/tmp", ...deps });
		expect(result).toMatchObject({ ok: false, reason: "no_such_workspace" });
	});

	it("reports no provider when neither declaration nor convention applies", () => {
		const result = resolveWorkspaceLedger({
			workspace: "rcdc5",
			cwd: "/tmp",
			...deps,
			fileExists: () => false,
		});
		expect(result).toMatchObject({ ok: false, reason: "no_provider" });
	});
});
