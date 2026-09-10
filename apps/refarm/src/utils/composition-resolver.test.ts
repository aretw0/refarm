import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { declaredBase } from "@refarm.dev/config";

import { resolveComposition, userScopeConfigPath } from "./composition-resolver.js";

/** Write a `config.json` under `<base>/.refarm/config.json`. */
function seedConfig(base: string, config: unknown): void {
	const dir = join(base, ".refarm");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2));
}

describe("resolveComposition (3-tier fold, org < workspace < user)", () => {
	let home: string;
	let cwd: string;
	let org: string;
	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "comp-home-"));
		cwd = mkdtempSync(join(tmpdir(), "comp-cwd-"));
		org = mkdtempSync(join(tmpdir(), "comp-org-"));
	});
	afterEach(() => {
		for (const d of [home, cwd, org]) rmSync(d, { recursive: true, force: true });
	});

	it("folds workspace + user, tagging each entry with its origin scope", () => {
		seedConfig(home, { plugins: ["@refarm/agent"] });
		seedConfig(cwd, { plugins: ["../local/pkg"] });
		const { plugins } = resolveComposition({ home, cwd, env: {} });
		const bySource = new Map(plugins.map((p) => [p.source, p.scope]));
		expect(bySource.get("@refarm/agent")).toBe("user");
		expect(bySource.get("../local/pkg")).toBe("workspace");
		expect(plugins).toHaveLength(2);
	});

	it("user overrides workspace for the same source (last-wins replace)", () => {
		// workspace declares the object (suppressing a skill); user re-declares it
		// as a bare string → user wins, and the whole entry is replaced.
		seedConfig(cwd, {
			plugins: [{ source: "npm:@acme/x", skills: ["!skills/legacy"] }],
		});
		seedConfig(home, { plugins: ["npm:@acme/x"] });
		const { plugins } = resolveComposition({ home, cwd, env: {} });
		expect(plugins).toHaveLength(1);
		expect(plugins[0]).toMatchObject({ source: "npm:@acme/x", scope: "user" });
		// The user's bare-string entry replaced the workspace object wholesale.
		expect(plugins[0]!.entry).toBe("npm:@acme/x");
	});

	it("includes the org tier only when REFARM_ORG_HOME is set (opt-in)", () => {
		seedConfig(org, { plugins: ["npm:@org/base"] });
		seedConfig(home, { plugins: ["@refarm/agent"] });

		const withoutOrg = resolveComposition({ home, cwd, env: {} });
		expect(withoutOrg.plugins.map((p) => p.source)).not.toContain("npm:@org/base");
		expect(withoutOrg.consulted.map((c) => c.scope)).toEqual(["workspace", "user"]);

		const withOrg = resolveComposition({
			home,
			cwd,
			env: { REFARM_ORG_HOME: org },
		});
		const orgEntry = withOrg.plugins.find((p) => p.source === "npm:@org/base");
		expect(orgEntry?.scope).toBe("org");
		expect(withOrg.consulted.map((c) => c.scope)).toEqual(["org", "workspace", "user"]);
	});

	it("a workspace/user copy of an org source overrides the org base", () => {
		seedConfig(org, {
			plugins: [{ source: "npm:@org/base", skills: [] }],
		});
		seedConfig(cwd, { plugins: ["npm:@org/base"] });
		const { plugins } = resolveComposition({
			home,
			cwd,
			env: { REFARM_ORG_HOME: org },
		});
		expect(plugins).toHaveLength(1);
		expect(plugins[0]).toMatchObject({ source: "npm:@org/base", scope: "workspace" });
	});

	it("a malformed config contributes nothing (does not crash the fold)", () => {
		mkdirSync(join(home, ".refarm"), { recursive: true });
		writeFileSync(join(home, ".refarm", "config.json"), "{ not json");
		seedConfig(cwd, { plugins: ["ok"] });
		const { plugins } = resolveComposition({ home, cwd, env: {} });
		expect(plugins.map((p) => p.source)).toEqual(["ok"]);
	});

	it("a config with no plugins field yields an empty set", () => {
		seedConfig(home, { autostart: "ask" });
		expect(resolveComposition({ home, cwd, env: {} }).plugins).toEqual([]);
	});
});

describe("co-habitation guarantee", () => {
	it("the user-tier config path is <home>/.refarm/config.json (config.ts convention)", () => {
		// Mirrors config.ts configPath({local:false}) = join(home, '.refarm', 'config.json').
		expect(userScopeConfigPath("/custom/home")).toBe(
			join("/custom/home", ".refarm", "config.json"),
		);
	});
});

describe("ISS-102 — the user tier follows the DECLARED base, and both sides agree", () => {
	/**
	 * The co-habitation guarantee: `config.ts` writes scalars and this module reads `plugins[]`,
	 * and they must be THE SAME FILE at every tier. Both used to anchor on `os.homedir()`, which
	 * kept them consistent and kept them wrong — under a declared home (a sandbox node, a second
	 * device) both answered the operator's OS home rather than the base the node declared.
	 *
	 * ISS-102 insisted they move in one change with a test pinning them to the same path, because
	 * moving one alone splits a file the composition layer depends on being single. This is that
	 * test.
	 */
	// THE SEAM ITSELF, not a re-derivation of it. `userScopeConfigPath` is what this module
	// exposes precisely so a test can assert it equals `config.ts`'s `configPath({local:false})`.
	// Rebuilding the path here would test my arithmetic instead of their agreement.
	const userTierPathFor = (env: NodeJS.ProcessEnv) => userScopeConfigPath(declaredBase(env));
	/** `config.ts`'s own rule, quoted: `path.join(deps.home(), ".refarm", "config.json")`. */
	const configTsWouldWrite = (env: NodeJS.ProcessEnv) =>
		join(declaredBase(env), ".refarm", "config.json");

	it("lands on the declared base, not the OS home, under REFARM_HOME", () => {
		const env = { HOME: "/home/op", REFARM_HOME: "/tmp/sandbox-node/.refarm" };
		expect(declaredBase(env)).toBe("/tmp/sandbox-node");
		expect(userTierPathFor(env)).toBe("/tmp/sandbox-node/.refarm/config.json");
	});

	it("SOVEREIGN_BASE wins, because it names the base directly", () => {
		const env = { HOME: "/home/op", REFARM_HOME: "/tmp/x/.refarm", SOVEREIGN_BASE: "/srv/node-a" };
		expect(userTierPathFor(env)).toBe("/srv/node-a/.refarm/config.json");
	});

	it("is byte-for-byte what it was when nothing is declared", () => {
		// The ordinary case must not move: `declaredBase` falls through to HOME, which is what
		// `os.homedir()` answered before. A change that altered this would have been a migration
		// wearing a bug-fix's clothes.
		expect(userTierPathFor({ HOME: "/home/op" })).toBe("/home/op/.refarm/config.json");
	});

	it("THE GUARANTEE: this resolver's user tier IS the file config.ts writes", () => {
		// Asserted rather than described. Under a declared home the two used to agree on the wrong
		// file; they must now agree on the right one, which is a stronger claim than either moving
		// alone could make.
		for (const env of [
			{ HOME: "/home/op" },
			{ HOME: "/home/op", REFARM_HOME: "/tmp/sandbox-node/.refarm" },
			{ HOME: "/home/op", SOVEREIGN_BASE: "/srv/node-a" },
		]) {
			expect(userTierPathFor(env)).toBe(configTsWouldWrite(env));
		}
	});
});
