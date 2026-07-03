import { describe, expect, it } from "vitest";

import {
	orderedScopeStorePaths,
	resolveScopedStorePath,
} from "./scope.js";

const OPTS = {
	userHome: "/home/tester",
	workspaceRoot: "/work/project",
};

describe("@refarm.dev/storage-fs scope resolution", () => {
	it("resolves user scope under <home>/.refarm", () => {
		expect(resolveScopedStorePath("user", "barn/ledger.json", OPTS)).toBe(
			"/home/tester/.refarm/barn/ledger.json",
		);
	});

	it("resolves workspace scope under <workspaceRoot>/.refarm", () => {
		expect(resolveScopedStorePath("workspace", "barn/ledger.json", OPTS)).toBe(
			"/work/project/.refarm/barn/ledger.json",
		);
	});

	it("passes absolute paths through unchanged (opt-out of scope)", () => {
		expect(resolveScopedStorePath("user", "/etc/refarm/x.json", OPTS)).toBe(
			"/etc/refarm/x.json",
		);
	});

	it("honours a custom ledger dir name", () => {
		expect(
			resolveScopedStorePath("workspace", "x.json", {
				...OPTS,
				ledgerDir: ".project",
			}),
		).toBe("/work/project/.project/x.json");
	});

	it("orders scopes user-first (apply order: workspace wins on fold)", () => {
		const ordered = orderedScopeStorePaths("config/overrides.json", OPTS);
		expect(ordered.map((s) => s.scope)).toEqual(["user", "workspace"]);
		expect(ordered.map((s) => s.path)).toEqual([
			"/home/tester/.refarm/config/overrides.json",
			"/work/project/.refarm/config/overrides.json",
		]);
	});
});
