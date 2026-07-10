import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	buildCompositionListEnvelope,
	buildCompositionMutationEnvelope,
	buildCompositionSuppressEnvelope,
} from "./config.js";

/** Seed `<base>/.refarm/config.json`. */
function seed(base: string, config: unknown): void {
	mkdirSync(join(base, ".refarm"), { recursive: true });
	writeFileSync(join(base, ".refarm", "config.json"), JSON.stringify(config));
}

describe("config plugins list envelope", () => {
	let home: string;
	let cwd: string;
	let org: string;
	function deps() {
		return { cwd: () => cwd, home: () => home };
	}
	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "cpl-home-"));
		cwd = mkdtempSync(join(tmpdir(), "cpl-cwd-"));
		org = mkdtempSync(join(tmpdir(), "cpl-org-"));
	});
	afterEach(() => {
		for (const d of [home, cwd, org]) rmSync(d, { recursive: true, force: true });
	});

	it("folds workspace + user and tags scope, with a clean handoff envelope", () => {
		seed(home, { plugins: ["@refarm/agent"] });
		seed(cwd, { plugins: [{ source: "npm:@acme/x", skills: ["!skills/legacy"] }] });
		const env = buildCompositionListEnvelope(deps(), { env: {} }) as {
			ok: boolean;
			count: number;
			scopesConsulted: string[];
			nextCommand: string | null;
			plugins: { source: string; scope: string; form: string }[];
		};
		expect(env.ok).toBe(true);
		expect(env.count).toBe(2);
		expect(env.scopesConsulted).toEqual(["workspace", "user"]);
		const bySource = new Map(env.plugins.map((p) => [p.source, p]));
		expect(bySource.get("@refarm/agent")).toMatchObject({ scope: "user", form: "bare" });
		expect(bySource.get("npm:@acme/x")).toMatchObject({
			scope: "workspace",
			form: "object",
		});
	});

	it("--effective expands an object entry's surface suppression", () => {
		seed(cwd, { plugins: [{ source: "npm:@acme/x", skills: ["!skills/legacy"] }] });
		const env = buildCompositionListEnvelope(deps(), {
			effective: true,
			env: {},
		}) as {
			plugins: { source: string; surfaces?: Record<string, unknown> }[];
		};
		const entry = env.plugins.find((p) => p.source === "npm:@acme/x");
		expect(entry?.surfaces).toEqual({
			skills: { patterns: ["!skills/legacy"], allActive: false },
		});
	});

	it("--scope filters the view to one tier", () => {
		seed(home, { plugins: ["user-only"] });
		seed(cwd, { plugins: ["ws-only"] });
		const env = buildCompositionListEnvelope(deps(), {
			scope: "user",
			env: {},
		}) as { plugins: { source: string }[]; count: number };
		expect(env.plugins.map((p) => p.source)).toEqual(["user-only"]);
		expect(env.count).toBe(1);
	});

	it("--scope org errors when REFARM_ORG_HOME is unset (opt-in)", () => {
		seed(cwd, { plugins: ["x"] });
		const env = buildCompositionListEnvelope(deps(), {
			scope: "org",
			env: {},
		}) as { ok: boolean; error?: string };
		expect(env.ok).toBe(false);
		expect(env.error).toBe("org-scope-unavailable");
	});

	it("--scope org resolves when REFARM_ORG_HOME points at a seeded org base", () => {
		seed(org, { plugins: ["npm:@org/base"] });
		const env = buildCompositionListEnvelope(deps(), {
			scope: "org",
			env: { REFARM_ORG_HOME: org },
		}) as { ok: boolean; plugins: { source: string; scope: string }[] };
		expect(env.ok).toBe(true);
		expect(env.plugins).toEqual([
			expect.objectContaining({ source: "npm:@org/base", scope: "org" }),
		]);
	});

	it("an unknown --scope value is a structured error", () => {
		const env = buildCompositionListEnvelope(deps(), {
			scope: "nope",
			env: {},
		}) as { ok: boolean; error?: string };
		expect(env.ok).toBe(false);
		expect(env.error).toBe("unknown-scope");
	});
});

describe("config plugins add / remove (RMW)", () => {
	let home: string;
	let cwd: string;
	let org: string;
	function deps() {
		return { cwd: () => cwd, home: () => home };
	}
	function readHomeConfig(): Record<string, unknown> {
		return JSON.parse(readFileSync(join(home, ".refarm", "config.json"), "utf-8"));
	}
	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "cpm-home-"));
		cwd = mkdtempSync(join(tmpdir(), "cpm-cwd-"));
		org = mkdtempSync(join(tmpdir(), "cpm-org-"));
	});
	afterEach(() => {
		for (const d of [home, cwd, org]) rmSync(d, { recursive: true, force: true });
	});

	it("add appends a bare-string entry and is idempotent by source", () => {
		const first = buildCompositionMutationEnvelope(deps(), "add", "@refarm/agent", {
			scope: "user",
			env: {},
		}) as { ok: boolean; changed: boolean };
		expect(first).toMatchObject({ ok: true, changed: true });
		expect(readHomeConfig().plugins).toEqual(["@refarm/agent"]);

		const second = buildCompositionMutationEnvelope(deps(), "add", "@refarm/agent", {
			scope: "user",
			env: {},
		}) as { changed: boolean };
		expect(second.changed).toBe(false); // idempotent — no duplicate
		expect(readHomeConfig().plugins).toEqual(["@refarm/agent"]);
	});

	it("add NEVER downgrades an existing object entry to a bare string", () => {
		seed(home, {
			plugins: [{ source: "npm:@acme/x", skills: ["!skills/legacy"] }],
		});
		const env = buildCompositionMutationEnvelope(deps(), "add", "npm:@acme/x", {
			scope: "user",
			env: {},
		}) as { changed: boolean };
		expect(env.changed).toBe(false);
		// The object entry (with its suppression) is preserved verbatim.
		expect(readHomeConfig().plugins).toEqual([
			{ source: "npm:@acme/x", skills: ["!skills/legacy"] },
		]);
	});

	it("remove de-declares and reports it is not a physical uninstall", () => {
		seed(home, { plugins: ["@refarm/agent", "keep-me"] });
		const env = buildCompositionMutationEnvelope(deps(), "remove", "@refarm/agent", {
			scope: "user",
			env: {},
		}) as { ok: boolean; changed: boolean; note?: string };
		expect(env).toMatchObject({ ok: true, changed: true });
		expect(env.note).toContain("not a physical uninstall");
		expect(readHomeConfig().plugins).toEqual(["keep-me"]);
	});

	it("remove of an absent source is a no-op", () => {
		seed(home, { plugins: ["keep-me"] });
		const env = buildCompositionMutationEnvelope(deps(), "remove", "ghost", {
			scope: "user",
			env: {},
		}) as { changed: boolean };
		expect(env.changed).toBe(false);
		expect(readHomeConfig().plugins).toEqual(["keep-me"]);
	});

	it("preserves scalar siblings across the RMW (co-habitation)", () => {
		seed(home, {
			autostart: "always",
			runtime: { sidecarUrl: "http://127.0.0.1:42001" },
		});
		buildCompositionMutationEnvelope(deps(), "add", "@refarm/agent", {
			scope: "user",
			env: {},
		});
		const after = readHomeConfig();
		expect(after.autostart).toBe("always");
		expect(after.runtime).toEqual({ sidecarUrl: "http://127.0.0.1:42001" });
		expect(after.plugins).toEqual(["@refarm/agent"]);
	});

	it("writes to the workspace scope's config.json when --scope workspace", () => {
		buildCompositionMutationEnvelope(deps(), "add", "../local", {
			scope: "workspace",
			env: {},
		});
		const wsConfig = JSON.parse(readFileSync(join(cwd, ".refarm", "config.json"), "utf-8"));
		expect(wsConfig.plugins).toEqual(["../local"]);
	});

	it("--scope org writes only when REFARM_ORG_HOME is set", () => {
		const denied = buildCompositionMutationEnvelope(deps(), "add", "x", {
			scope: "org",
			env: {},
		}) as { ok: boolean; error?: string };
		expect(denied).toMatchObject({ ok: false, error: "org-scope-unavailable" });

		const allowed = buildCompositionMutationEnvelope(deps(), "add", "npm:@org/base", {
			scope: "org",
			env: { REFARM_ORG_HOME: org },
		}) as { ok: boolean; changed: boolean };
		expect(allowed).toMatchObject({ ok: true, changed: true });
		const orgConfig = JSON.parse(readFileSync(join(org, ".refarm", "config.json"), "utf-8"));
		expect(orgConfig.plugins).toEqual(["npm:@org/base"]);
	});

	it("rejects an empty source and an unknown scope", () => {
		expect(
			(
				buildCompositionMutationEnvelope(deps(), "add", "   ", { env: {} }) as {
					error?: string;
				}
			).error,
		).toBe("empty-source");
		expect(
			(
				buildCompositionMutationEnvelope(deps(), "add", "x", {
					scope: "nope",
					env: {},
				}) as { error?: string }
			).error,
		).toBe("unknown-scope");
	});
});

describe("config plugins suppress / unsuppress (the !-grammar)", () => {
	let home: string;
	let cwd: string;
	function deps() {
		return { cwd: () => cwd, home: () => home };
	}
	function homePlugins(): unknown[] {
		return JSON.parse(readFileSync(join(home, ".refarm", "config.json"), "utf-8")).plugins;
	}
	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "cps-home-"));
		cwd = mkdtempSync(join(tmpdir(), "cps-cwd-"));
	});
	afterEach(() => {
		for (const d of [home, cwd]) rmSync(d, { recursive: true, force: true });
	});

	it("suppress promotes a bare entry to object form and writes a !pattern", () => {
		seed(home, { plugins: ["npm:@acme/x"] });
		const env = buildCompositionSuppressEnvelope(
			deps(),
			"suppress",
			"npm:@acme/x",
			"skills",
			"skills/legacy",
			{ scope: "user", env: {} },
		) as { ok: boolean; changed: boolean; entry: unknown };
		expect(env).toMatchObject({ ok: true, changed: true });
		expect(env.entry).toEqual({ source: "npm:@acme/x", skills: ["!skills/legacy"] });
		expect(homePlugins()).toEqual([{ source: "npm:@acme/x", skills: ["!skills/legacy"] }]);
	});

	it("suppress is Set-union (a repeated pattern is a no-op)", () => {
		seed(home, { plugins: [{ source: "x", skills: ["!skills/a"] }] });
		const env = buildCompositionSuppressEnvelope(deps(), "suppress", "x", "skills", "skills/a", {
			env: {},
		}) as { changed: boolean };
		expect(env.changed).toBe(false);
		expect(homePlugins()).toEqual([{ source: "x", skills: ["!skills/a"] }]);
	});

	it("unsuppress drops the key when the surface empties (restores all-active)", () => {
		seed(home, { plugins: [{ source: "x", skills: ["!skills/a"] }] });
		const env = buildCompositionSuppressEnvelope(deps(), "unsuppress", "x", "skills", "skills/a", {
			env: {},
		}) as { changed: boolean; entry: unknown };
		expect(env.changed).toBe(true);
		// The surface key is gone AND the entry collapsed back to a bare string.
		expect(env.entry).toBe("x");
		expect(homePlugins()).toEqual(["x"]);
	});

	it("unsuppress keeps other patterns and stays an object", () => {
		seed(home, { plugins: [{ source: "x", skills: ["!skills/a", "!skills/b"] }] });
		buildCompositionSuppressEnvelope(deps(), "unsuppress", "x", "skills", "skills/a", {
			env: {},
		});
		expect(homePlugins()).toEqual([{ source: "x", skills: ["!skills/b"] }]);
	});

	it("rejects a mode-flip (bare include + new !exclude) unless allowed", () => {
		// An allowlist entry (bare include, no !) — adding an exclude flips meaning.
		seed(home, { plugins: [{ source: "x", skills: ["skills/keep"] }] });
		const denied = buildCompositionSuppressEnvelope(
			deps(),
			"suppress",
			"x",
			"skills",
			"skills/other",
			{ env: {} },
		) as { ok: boolean; error?: string };
		expect(denied).toMatchObject({ ok: false, error: "mode-flip" });

		const allowed = buildCompositionSuppressEnvelope(
			deps(),
			"suppress",
			"x",
			"skills",
			"skills/other",
			{ allowModeFlip: true, env: {} },
		) as { ok: boolean; changed: boolean };
		expect(allowed).toMatchObject({ ok: true, changed: true });
		expect(homePlugins()).toEqual([{ source: "x", skills: ["skills/keep", "!skills/other"] }]);
	});

	it("rejects an unknown surface and an undeclared source", () => {
		seed(home, { plugins: ["x"] });
		expect(
			(
				buildCompositionSuppressEnvelope(deps(), "suppress", "x", "bogus", "y", {
					env: {},
				}) as { error?: string }
			).error,
		).toBe("unknown-surface");
		expect(
			(
				buildCompositionSuppressEnvelope(deps(), "suppress", "ghost", "skills", "y", {
					env: {},
				}) as { error?: string }
			).error,
		).toBe("source-not-declared");
	});
});
