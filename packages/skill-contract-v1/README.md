# @refarm.dev/skill-contract-v1

Versioned `skill:v1` contract for Refarm-native skill surfaces.

This package owns the safe contract boundary for `SKILL.md`-style workflow
content:

- parse frontmatter and Markdown instructions into `SkillManifestV1`;
- record source URI, byte length, and SHA-256 hash;
- verify a loaded `SKILL.md` source against the source reference already carried
  by a manifest or invocation plan;
- expose markdown input/output envelopes for hosts to validate before invoking
  policy or engines;
- carry declarative engine bindings so hosts can check available Refarm engines
  before runtime dispatch;
- require explicit capability declarations before a manifest is accepted;
- default to `plan-only` execution and `declared-capabilities-only` tool access;
- build a host-policy-checkable invocation plan that preserves source integrity,
  requested capabilities, policy, and Markdown instructions without executing
  the skill;
- build a host-policy-checkable invocation request from a plan and markdown
  input without calling a runtime;
- build a host policy decision from a request, approving or denying the
  requested capabilities while keeping the artifact pre-runtime and unexecuted;
- build a plugin-manifest-compatible skill surface declaration
  (`layer: "pi", kind: "skill"`) from a validated manifest and package asset
  path;
- prepare a manifest and invocation plan from one `SKILL.md` source so hosts and
  adapters do not reimplement the parse/build handoff;
- provide conformance helpers for future adapters and hosts.

It does not execute skills, install skills, vendor external skill text, or call
runtime-agent directly. It is not a parallel plugin system.

The distribution unit remains the package/plugin bundle. A package may ship
`SKILL.md`, guides, references, themes, and executable extensions together, but
activation must pass through the existing plugin manifest, Barn, Scarecrow, and
host capability gates. The intended shape is a manifest-declared surface such as
`layer: "pi", kind: "skill"` with `assets` pointing at the `SKILL.md`; hosts
such as `runtime-agent`, `pi-agent`, or another Refarm plugin consume this
contract only after that boundary accepts the surface.

## Example

```ts
import {
	buildSkillInvocationDecision,
	buildSkillInvocationRequest,
	buildSkillSurfaceDeclaration,
	prepareSkillInvocationPlan,
	verifySkillSource,
} from "@refarm.dev/skill-contract-v1";

const result = prepareSkillInvocationPlan(skillMarkdown, {
	sourceUri: "file:skills/refarm-git-workflow/SKILL.md",
});

if (!result.ok) {
	throw new Error(result.issues.map((issue) => issue.message).join("; "));
}

const sourceCheck = verifySkillSource(skillMarkdown, result.plan.skill.source, {
	sourceUri: "file:skills/refarm-git-workflow/SKILL.md",
});
if (!sourceCheck.ok) {
	throw new Error(sourceCheck.issues.map((issue) => issue.message).join("; "));
}

console.log(result.plan.io.input.format); // "text/markdown"
console.log(result.plan.engineBindings.requires); // declared engine binding ids

const surface = buildSkillSurfaceDeclaration(result.manifest, {
	assetPath: "skills/refarm-git-workflow/SKILL.md",
});
if (!surface.ok) {
	throw new Error(surface.issues.map((issue) => issue.message).join("; "));
}

const request = buildSkillInvocationRequest(result.plan, "Review this working tree.");
if (!request.ok) {
	throw new Error(request.issues.map((issue) => issue.message).join("; "));
}

const decision = buildSkillInvocationDecision(request.request, {
	decision: "approved",
	reason: "Operator approved the required workflow capabilities.",
	approvedCapabilities: result.plan.capabilityRequests
		.filter((item) => item.required)
		.map((item) => item.id),
});
if (!decision.ok) {
	throw new Error(decision.issues.map((issue) => issue.message).join("; "));
}
```

`requiredCapabilities` is mandatory in frontmatter. A `SKILL.md` without it
fails closed instead of becoming an executable artifact by accident.
Invocation plans always require host policy approval; this package does not
authorize tools by itself.
Source verification only confirms content identity; it does not install, trust,
or execute a skill.
The I/O envelope is descriptive and policy-facing. Hosts still decide whether a
particular invocation payload is allowed.
Engine bindings are declarations only. This package does not select or call an
engine implementation.
Invocation requests are still pre-runtime artifacts; hosts must approve policy
before dispatch.
Invocation decisions are also pre-runtime artifacts. An approved decision may
set `requiresRuntimeDispatch: true`, but it must still carry `executed: false`
until a host-owned dispatcher records actual engine-call evidence.
Skill surface declarations require a relative package asset path; local
`file:`/`fixture:` sources can be reviewed and parsed before packaging, but they
do not become package manifest assets by accident.
