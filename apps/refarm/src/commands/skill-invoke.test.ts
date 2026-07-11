import { describe, expect, it, vi } from "vitest";

import { runSkillInvocation, type SkillInvocationSource } from "./skill-invoke.js";

const SKILL_MD = `---
name: git-flow
description: A git workflow.
requiredCapabilities:
  - sovereign.operator-loop
  - sovereign.git.write
optionalCapabilities:
  - sovereign.github.pr
engineBindings:
  - runtime-agent
input: Task context.
inputRequired: true
output: A plan.
---

# Git Flow

Run the loop, keep source sovereignty.
`;

function source(text = SKILL_MD): SkillInvocationSource {
	return { label: "fixture:SKILL.md", read: () => text };
}

describe("runSkillInvocation (neutral plan → request → decision loop)", () => {
	it("plans without an input (a no-input call is a pure plan preview)", async () => {
		const result = await runSkillInvocation(source(), "");
		expect(result.ok).toBe(true);
		expect(result.plan?.skill.name).toBe("git-flow");
		expect(result.plan?.capabilityRequests.map((c) => c.id)).toEqual([
			"sovereign.operator-loop",
			"sovereign.git.write",
			"sovereign.github.pr",
		]);
		// No input → no request, no decision.
		expect(result.request).toBeNull();
		expect(result.decision).toBeNull();
	});

	it("builds a request once an input is supplied (plan-only, no approval)", async () => {
		const result = await runSkillInvocation(source(), "rebase please");
		expect(result.ok).toBe(true);
		expect(result.request?.input.body).toBe("rebase please");
		expect(result.decision).toBeNull();
		expect(result.persisted).toBe(false);
	});

	it("approves and grants exactly the listed capabilities; unlisted → denied", async () => {
		const result = await runSkillInvocation(
			source(),
			"rebase",
			{},
			{
				decision: "approved",
				reason: "trusted",
				approvedCapabilities: ["sovereign.operator-loop", "sovereign.git.write"],
			},
		);
		expect(result.ok).toBe(true);
		expect(result.decision?.decision).toBe("approved");
		// The approval gate: requiresRuntimeDispatch true, but NEVER executed here.
		expect(result.decision?.requiresRuntimeDispatch).toBe(true);
		const grants = new Map(result.decision!.capabilityDecisions.map((c) => [c.id, c.decision]));
		expect(grants.get("sovereign.operator-loop")).toBe("approved");
		expect(grants.get("sovereign.git.write")).toBe("approved");
		expect(grants.get("sovereign.github.pr")).toBe("denied"); // optional, unlisted
	});

	it("fails the gate when a required capability is not approved", async () => {
		const result = await runSkillInvocation(
			source(),
			"rebase",
			{},
			{
				decision: "approved",
				reason: "partial",
				approvedCapabilities: ["sovereign.operator-loop"], // missing sovereign.git.write
			},
		);
		expect(result.ok).toBe(false);
		expect(result.issues.map((i) => i.code)).toContain(
			"INVOCATION_REQUIRED_CAPABILITY_NOT_APPROVED",
		);
	});

	it("denies without granting any capability", async () => {
		const result = await runSkillInvocation(
			source(),
			"rebase",
			{},
			{
				decision: "denied",
				reason: "untrusted source",
			},
		);
		expect(result.ok).toBe(true);
		expect(result.decision?.decision).toBe("denied");
		expect(result.decision!.capabilityDecisions.every((c) => c.decision === "denied")).toBe(true);
	});

	it("persists a built decision through the injected sink", async () => {
		const persistDecision = vi.fn();
		const result = await runSkillInvocation(
			source(),
			"rebase",
			{ persistDecision },
			{
				decision: "denied",
				reason: "no",
			},
		);
		expect(result.persisted).toBe(true);
		expect(persistDecision).toHaveBeenCalledOnce();
		// The sink receives the decision AND the source (for labeling/provenance).
		expect(persistDecision.mock.calls[0]![0].decision).toBe("denied");
		expect(persistDecision.mock.calls[0]![1].label).toBe("fixture:SKILL.md");
	});

	it("does not persist a plan-only run (no approval → no sink call)", async () => {
		const persistDecision = vi.fn();
		await runSkillInvocation(source(), "rebase", { persistDecision });
		expect(persistDecision).not.toHaveBeenCalled();
	});

	it("reports parse issues for a malformed SKILL.md (never throws)", async () => {
		const result = await runSkillInvocation(source("no frontmatter here"), "x");
		expect(result.ok).toBe(false);
		expect(result.plan).toBeNull();
		expect(result.issues.length).toBeGreaterThan(0);
	});
});
