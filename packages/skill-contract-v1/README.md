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
