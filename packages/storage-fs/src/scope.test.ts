import { describe, expect, it } from "vitest";

import { orderedScopeStorePaths, resolveScopedStorePath } from "./scope.js";

const OPTS = {
	userHome: "/home/tester",
	workspaceRoot: "/work/project",
};
const ORG_OPTS = {
	...OPTS,
	orgRoot: "/mnt/refarm-org/acme",
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

	it("resolves org scope under an injected orgRoot", () => {
		expect(resolveScopedStorePath("org", "barn/ledger.json", ORG_OPTS)).toBe(
			"/mnt/refarm-org/acme/.refarm/barn/ledger.json",
		);
	});

	it("requires orgRoot when resolving org scope directly", () => {
		expect(() => resolveScopedStorePath("org", "barn/ledger.json", OPTS)).toThrow(
			"`org` ledger scope has no filesystem default",
		);
	});

	it("passes absolute paths through unchanged (opt-out of scope)", () => {
		expect(resolveScopedStorePath("user", "/etc/refarm/x.json", OPTS)).toBe("/etc/refarm/x.json");
	});

	it("honours a custom ledger dir name", () => {
		expect(
			resolveScopedStorePath("workspace", "x.json", {
				...OPTS,
				ledgerDir: ".project",
			}),
		).toBe("/work/project/.project/x.json");
	});

	it("orders active local scopes in apply order (workspace base, user override)", () => {
		const ordered = orderedScopeStorePaths("config/overrides.json", OPTS);
		expect(ordered.map((s) => s.scope)).toEqual(["workspace", "user"]);
		expect(ordered.map((s) => s.path)).toEqual([
			"/work/project/.refarm/config/overrides.json",
			"/home/tester/.refarm/config/overrides.json",
		]);
	});

	it("includes org as the lowest-precedence layer only when orgRoot is supplied", () => {
		const ordered = orderedScopeStorePaths("config/overrides.json", ORG_OPTS);
		expect(ordered.map((s) => s.scope)).toEqual(["org", "workspace", "user"]);
		expect(ordered.map((s) => s.path)).toEqual([
			"/mnt/refarm-org/acme/.refarm/config/overrides.json",
			"/work/project/.refarm/config/overrides.json",
			"/home/tester/.refarm/config/overrides.json",
		]);
	});
});
