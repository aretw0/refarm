import type {
	SkillContractV1Adapter,
	SkillContractV1ConformanceResult,
	SkillManifestV1,
} from "./types.js";

export const VALID_SKILL_MARKDOWN_FIXTURE = `---
name: refarm-git-workflow
description: >
  Refarm operator git workflow wrapper.
requiredCapabilities:
  - refarm.operator-loop
  - refarm.git.write
optionalCapabilities:
  - refarm.github.pr
---

# Refarm Git Workflow

Start with the operator loop, keep source sovereignty, and only then run git workflow steps.
`;

export const MISSING_CAPABILITIES_SKILL_MARKDOWN_FIXTURE = `---
name: refarm-git-workflow
description: Refarm operator git workflow wrapper.
---

# Refarm Git Workflow

This content has no capability declaration and must fail closed.
`;

export async function runSkillContractV1Conformance(
	adapter: SkillContractV1Adapter,
): Promise<SkillContractV1ConformanceResult> {
	const failures: string[] = [];
	let total = 0;

	total++;
	let manifest: SkillManifestV1 | null = null;
	try {
		const result = await adapter.parseMarkdown(VALID_SKILL_MARKDOWN_FIXTURE, {
			sourceUri: "fixture:refarm-git-workflow/SKILL.md",
		});
		if (!result.ok || !result.manifest) {
			failures.push(`valid SKILL.md did not parse: ${formatIssues(result.issues)}`);
		} else {
			manifest = result.manifest;
		}
	} catch (error) {
		failures.push(`parseMarkdown(valid) threw: ${String(error)}`);
	}

	total++;
	if (manifest) {
		if (manifest.schema !== "refarm.skill-manifest.v1") {
			failures.push("manifest schema must be refarm.skill-manifest.v1");
		}
		if (manifest.source.format !== "SKILL.md") {
			failures.push("manifest source format must be SKILL.md");
		}
		if (!/^[a-f0-9]{64}$/.test(manifest.source.sha256)) {
			failures.push("manifest source sha256 must be lowercase SHA-256 hex");
		}
		if (!manifest.capabilities.requires.includes("refarm.operator-loop")) {
			failures.push("manifest must preserve required capabilities");
		}
		if (manifest.policy.toolAccess !== "declared-capabilities-only") {
			failures.push("manifest must default to declared capability tool access");
		}
	}

	total++;
	if (manifest) {
		try {
			const result = await adapter.buildInvocationPlan(manifest);
			if (!result.ok || !result.plan) {
				failures.push(`valid manifest did not build invocation plan: ${formatIssues(result.issues)}`);
			} else {
				if (result.plan.schema !== "refarm.skill-invocation-plan.v1") {
					failures.push("invocation plan schema must be refarm.skill-invocation-plan.v1");
				}
				if (result.plan.requiresHostPolicyApproval !== true) {
					failures.push("invocation plan must require host policy approval");
				}
				if (!result.plan.capabilityRequests.some((item) =>
					item.id === "refarm.operator-loop" && item.required === true
				)) {
					failures.push("invocation plan must preserve required capability requests");
				}
			}
		} catch (error) {
			failures.push(`buildInvocationPlan(valid) threw: ${String(error)}`);
		}
	}

	total++;
	try {
		const result = await adapter.prepareInvocationPlan(VALID_SKILL_MARKDOWN_FIXTURE, {
			sourceUri: "fixture:refarm-git-workflow/SKILL.md",
		});
		if (!result.ok || !result.manifest || !result.plan) {
			failures.push(`valid SKILL.md did not prepare invocation plan: ${formatIssues(result.issues)}`);
		} else {
			if (result.plan.skill.id !== result.manifest.id) {
				failures.push("prepared invocation plan must reference the prepared manifest");
			}
			if (result.plan.skill.source.sha256 !== result.manifest.source.sha256) {
				failures.push("prepared invocation plan must preserve manifest source integrity");
			}
		}
	} catch (error) {
		failures.push(`prepareInvocationPlan(valid) threw: ${String(error)}`);
	}

	total++;
	try {
		const result = await adapter.parseMarkdown(MISSING_CAPABILITIES_SKILL_MARKDOWN_FIXTURE);
		if (result.ok || result.manifest) {
			failures.push("SKILL.md without required capabilities must fail closed");
		}
		if (!result.issues.some((item) => item.code === "CAPABILITY_LIST_EMPTY")) {
			failures.push("missing capabilities failure must report CAPABILITY_LIST_EMPTY");
		}
	} catch (error) {
		failures.push(`parseMarkdown(missing capabilities) threw: ${String(error)}`);
	}

	total++;
	if (manifest) {
		const invalid: SkillManifestV1 = {
			...manifest,
			capabilities: { requires: [] },
		};
		try {
			const result = await adapter.validateManifest(invalid);
			if (result.ok) {
				failures.push("validateManifest must reject empty required capabilities");
			}
		} catch (error) {
			failures.push(`validateManifest(invalid) threw: ${String(error)}`);
		}
	}

	return {
		pass: failures.length === 0,
		total,
		failed: failures.length,
		failures,
	};
}

function formatIssues(issues: readonly { code: string; path: string; message: string }[]): string {
	return issues.map((item) => `${item.code} ${item.path}: ${item.message}`).join("; ");
}
