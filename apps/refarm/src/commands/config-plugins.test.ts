import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCompositionListEnvelope } from "./config.js";

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
