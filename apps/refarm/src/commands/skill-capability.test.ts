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

function deps(
	skills: DiscoveredSkill[] = [],
	rejected: Rejected = [],
): SkillCommandDeps {
	return { discover: () => ({ skills, rejected }) };
}

describe("skill CapabilityGroup", () => {
	it("is a group with list + show and a read-only list default", () => {
		const group = createSkillCapabilityGroup(deps());
		expect(isCapabilityGroup(group)).toBe(true);
		expect(Object.keys(group.actions).sort()).toEqual(["list", "show"]);
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
});
