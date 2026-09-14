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

// ISS-050. `scopeRoot`'s user tier read `options.userHome ?? homedir()`, so every consumer of
// `scopedAssetsDir` that did not pass a home silently landed on the OS home. Confirmed on disk: a
// plugin install wrote the working tree's agent.wasm into the OPERATOR's real ~/.refarm/assets/
// while a sandbox home was declared — which is why HOME became the sandbox launcher's sixth
// isolated axis rather than being assumed to follow REFARM_HOME.
//
// The org tier in this same function already refuses rather than defaulting (MissingOrgRootError).
// The user tier now does the same: "the fix is removing the default, not removing the concept" —
// a caller that genuinely wants the OS home says so, and the ones that wanted the declared home
// stop getting the other by accident.
describe("the user tier refuses to guess a home (ISS-050)", () => {
	it("throws rather than silently landing on the OS home", () => {
		expect(() => orderedScopeStorePaths("config.json", {})).toThrow(/userHome/);
	});

	it("resolves under the home it is given", () => {
		const paths = orderedScopeStorePaths("config.json", { userHome: "/declared/base" });
		const user = paths.find((entry) => entry.scope === "user");
		expect(user?.path).toBe("/declared/base/.refarm/config.json");
	});

	it("still drops the org tier when no org root is supplied, rather than erroring", () => {
		// The org tier is opt-in and its absence drops the layer; only an explicitly REQUESTED org
		// scope throws. Pinned here so the user tier's new refusal is not read as a change to it.
		const scopes = orderedScopeStorePaths("config.json", { userHome: "/h" }).map((e) => e.scope);
		expect(scopes).toEqual(["workspace", "user"]);
	});
});
