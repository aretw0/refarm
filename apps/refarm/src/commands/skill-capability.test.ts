import {
	isCapabilityGroup,
	resolveGroupAction,
} from "@refarm.dev/cli/capabilities";
import type { DiscoveredSkill } from "@refarm.dev/plugin-surface-loader/node";
import { describe, expect, it } from "vitest";

import {
	createSkillCapabilityGroup,
	skillCapabilityHooks,
	type SkillCommandDeps,
} from "./skill-capability.js";

function skill(overrides: Partial<DiscoveredSkill> = {}): DiscoveredSkill {
	return {
		surfaceId: "greet",
		id: "urn:skill:greet",
		name: "greet-operator",
		description: "Greet the operator.",
		requiredCapabilities: ["refarm.operator-loop"],
		instructions: "# Greet\n\nGreet the operator and summarize the day.",
		pluginId: "@demo/plugin",
		pluginDir: "/plugins/demo",
		...overrides,
	};
}

type Rejected = ReturnType<SkillCommandDeps["discover"]>["rejected"];
type Checker = Awaited<ReturnType<SkillCommandDeps["loadCheckers"]>>[number];
type ImportResult = ReturnType<SkillCommandDeps["importSkills"]>;

function deps(
	skills: DiscoveredSkill[] = [],
	rejected: Rejected = [],
	checkers: Checker[] = [],
	imported: ImportResult = { skills: [], rejected: [] },
): SkillCommandDeps {
	return {
		discover: () => ({ skills, rejected }),
		loadCheckers: async () => checkers,
		importSkills: () => imported,
	};
}

describe("skill CapabilityGroup", () => {
	it("is a group with list + show + check + import and a read-only list default", () => {
		const group = createSkillCapabilityGroup(deps());
		expect(isCapabilityGroup(group)).toBe(true);
		expect(Object.keys(group.actions).sort()).toEqual(["check", "import", "list", "show"]);
		expect(group.defaultAction).toBe("list");
	});

	it("carries multi-surface hints from one declaration", () => {
		const group = createSkillCapabilityGroup(deps());
		expect(group.transports?.cli).toBeDefined();
		expect(group.transports?.repl?.slashAliases).toContain("skills");
		expect(group.transports?.http).toEqual({ method: "GET", path: "/skills" });
	});

	it("`list` projects discovered skills with a maturity hint", async () => {
		const group = createSkillCapabilityGroup(
			deps([skill(), skill({ id: "urn:skill:note", name: "note", requiredCapabilities: [] })]),
		);
		const resolved = resolveGroupAction(group, []);
		expect(resolved?.key).toBe("list");
		const envelope = (await resolved!.action.run(resolved!.input)) as unknown as {
			count: number;
			skills: { name: string; maturity: string }[];
		};
		expect(envelope.count).toBe(2);
		expect(envelope.skills.find((s) => s.name === "greet-operator")?.maturity).toBe(
			"complete",
		);
		// A skill with no capabilities is surfaced as permissive (hint, not gate).
		expect(envelope.skills.find((s) => s.name === "note")?.maturity).toBe(
			"permissive",
		);
	});

	it("`show <id>` resolves by id or name; unknown → error envelope", async () => {
		const group = createSkillCapabilityGroup(deps([skill()]));

		const byName = resolveGroupAction(group, ["show", "greet-operator"]);
		const ok = await byName!.action.run(byName!.input);
		expect(ok.ok).toBe(true);
		expect((ok as { skill?: { name: string } }).skill?.name).toBe("greet-operator");

		const byId = resolveGroupAction(group, ["show", "urn:skill:greet"]);
		expect((await byId!.action.run(byId!.input)).ok).toBe(true);

		const missing = resolveGroupAction(group, ["show", "nope"]);
		const err = await missing!.action.run(missing!.input);
		expect(err.ok).toBe(false);
		expect((err as { error?: string }).error).toBe("skill-not-found");
	});

	it("`check <id>` runs checkers over the skill text → findings as pending-actions", async () => {
		// A fake checker standing in for the sandboxed WASM one: it fires on the
		// skill's instructions and returns a finding.
		const fakeChecker: Checker = {
			check: () => [
				{
					severity: "warn",
					ruleId: "ai-self-reference",
					message: "AI tell in instructions",
				},
			],
		};
		const group = createSkillCapabilityGroup(
			deps(
				[skill({ instructions: "As an AI language model, I help." })],
				[],
				[fakeChecker],
			),
		);
		const resolved = resolveGroupAction(group, ["check", "greet-operator"]);
		const envelope = (await resolved!.action.run(resolved!.input)) as unknown as {
			ok: boolean;
			findingCount: number;
			checkersRun: number;
			recommendations: { diagnostic: string }[];
			nextActions: string[];
		};
		// Findings are POLICY: ok stays true (a skill with tells still exists), but
		// a pending-action is surfaced on the tri-interface.
		expect(envelope.ok).toBe(true);
		expect(envelope.checkersRun).toBe(1);
		expect(envelope.findingCount).toBe(1);
		expect(envelope.recommendations[0]!.diagnostic).toBe("ai-self-reference");
		expect(envelope.nextActions.length).toBeGreaterThan(0);
	});

	it("`check` with no findings reports ok and zero pending-actions", async () => {
		const cleanChecker: Checker = { check: () => [] };
		const group = createSkillCapabilityGroup(
			deps([skill()], [], [cleanChecker]),
		);
		const resolved = resolveGroupAction(group, ["check", "greet-operator"]);
		const envelope = (await resolved!.action.run(resolved!.input)) as unknown as {
			ok: boolean;
			findingCount: number;
			nextActions: string[];
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.findingCount).toBe(0);
		expect(envelope.nextActions).toEqual([]);
	});

	it("`import <dir>` reports translated Agent Skills from a directory", async () => {
		const group = createSkillCapabilityGroup(
			deps([], [], [], {
				skills: [
					{
						surfaceId: "commit",
						id: "urn:skill:commit",
						name: "commit",
						description: "Read before committing",
						requiredCapabilities: [],
						instructions: "Make a commit.",
						skillDir: "/ext/skills/commit",
						translated: { nameInjected: false, newlinesNormalized: false },
					},
					{
						surfaceId: "win",
						id: "urn:skill:win",
						name: "win",
						requiredCapabilities: [],
						instructions: "Body.",
						skillDir: "/ext/skills/win",
						translated: { nameInjected: true, newlinesNormalized: true },
					},
				],
				rejected: [{ skillDir: "/ext/skills/bad", issues: ["FRONTMATTER_MISSING: x"] }],
			}),
		);
		const resolved = resolveGroupAction(group, ["import", "/ext/skills"]);
		expect(resolved?.key).toBe("import");
		const envelope = (await resolved!.action.run(resolved!.input)) as unknown as {
			ok: boolean;
			source: string;
			count: number;
			imported: { name: string; translated: { nameInjected: boolean } }[];
			rejected: { skillDir: string }[];
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.source).toBe("/ext/skills");
		expect(envelope.count).toBe(2);
		expect(envelope.imported.map((s) => s.name).sort()).toEqual(["commit", "win"]);
		expect(envelope.imported.find((s) => s.name === "win")?.translated.nameInjected).toBe(true);
		expect(envelope.rejected).toHaveLength(1);
	});

	it("hooks render the import listing (with translation tags) and a not-found error", () => {
		const listing = skillCapabilityHooks("import").renderText!({
			ok: true,
			source: "/ext/skills",
			count: 1,
			imported: [
				{
					name: "win",
					id: "urn:skill:win",
					translated: { nameInjected: true, newlinesNormalized: true },
				},
			],
			rejected: [],
		} as never);
		expect(listing).toContain("win");
		expect(listing).toContain("name-injected");
	});

	it("hooks render the empty-state hint and a not-found error", () => {
		const emptyList = skillCapabilityHooks("list").renderText!(
			{ count: 0, skills: [], rejected: [] } as never,
		);
		expect(emptyList).toContain("No skills found");

		const notFound = skillCapabilityHooks("show").renderText!({
			ok: false,
			message: 'No installed skill matches "nope".',
		} as never);
		expect(notFound).toContain("nope");
	});

	it("hooks render check findings + a no-findings pass", () => {
		const withFindings = skillCapabilityHooks("check").renderText!({
			ok: true,
			skill: { name: "greet-operator" },
			findingCount: 1,
			checkersRun: 2,
			recommendations: [
				{ diagnostic: "ai-self-reference", summary: "AI tell" },
			],
			nextActions: ["Revise the skill's instructions."],
		} as never);
		expect(withFindings).toContain("ai-self-reference");
		expect(withFindings).toContain("pending action");

		const clean = skillCapabilityHooks("check").renderText!({
			ok: true,
			skill: { name: "greet-operator" },
			findingCount: 0,
			checkersRun: 1,
			recommendations: [],
			nextActions: [],
		} as never);
		expect(clean).toContain("no findings");
	});
});
