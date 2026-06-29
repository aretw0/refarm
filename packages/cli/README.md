# @refarm.dev/cli

Shared CLI contracts and process-safe helpers used by the Refarm app and other
operator surfaces.

This package is not the Refarm application entrypoint. It holds reusable
building blocks that should remain useful outside the app layer:

- JSON success/error envelopes and command-result parsing.
- Command handoff builders, including agnostic application/binary command
  helpers. App-specific wrappers belong in their app layer.
- Command plan and execution plan envelopes.
- Surface action affordance formatting and selection.
- Browser-open, launch-readiness, Git, and GitHub Actions adapters.
- Runner-style process adapters for consumer CLIs that already expose
  `(command, args, options) => Promise<void>` execution seams.
- Compact capability discovery, including the reference-driver supply map that
  tells consumers which primitives are SDK exports, runtime artifacts, WIT
  boundaries, crate-held implementations, or publication holds.
- Refarm status schema contracts and compatibility aliases where public callers
  still rely on Refarm-specific names.

## Boundary

Keep product orchestration in `apps/refarm`. Move reusable contracts and
spawn-safe process helpers here when more than one surface or command can use
them.

Prefer agnostic primary names for new reusable helpers. Keep Refarm-specific
exports only when they describe a public Refarm contract.

For host browser handoff, prefer `BROWSER_OPEN_COMMAND` as the generic override.
`REFARM_BROWSER_OPEN_COMMAND` remains supported only as a Refarm compatibility
alias.

## Runner Adapter

Consumer CLIs can keep their own command vocabulary and inject Refarm's process
adapter only at the execution boundary:

```ts
import { createLaunchProcessRunner } from "@refarm.dev/launch-process";

const runner = createLaunchProcessRunner();
await runner("node", ["scripts/prepare_lab_datasets.mjs"], {
	cwd: "/workspaces/vault",
	display: "node scripts/prepare_lab_datasets.mjs",
});
```

The adapter builds a structured process spec, executes it without shell parsing,
and rejects non-zero exit codes. This is the intended bridge for product-local
CLIs such as vault cockpits: their commands stay local, while Refarm can later
record richer handoffs, provenance, and task artifacts around the same process
boundary.

`@refarm.dev/cli/launch-process` remains a compatibility re-export. New
consumers should import `@refarm.dev/launch-process` so they do not pull the
full CLI dependency closure.

Structured process handoffs should identify the producing executor through
`process.tool`, not by parsing `display` or argv strings. Use labels such as
`package-script` and `turbo` today; future adapters can add labels such as `nx`,
`make`, or `cargo` without changing command-plan consumers. Cache reporting uses
the generic `CommandPlanCacheObservation` shape. Tool-specific packages may parse
runner output, but command-plan JSON should expose normalized `cache` fields and
aggregate `cache.steps[]` data.

See [ROADMAP.md](./ROADMAP.md) for the strategic evolution of the CLI.

## Capability Discovery

Consumers can inspect Refarm's compact capability surface without scraping docs
or invoking a provider:

```ts
import {
	buildRefarmCapabilityIndex,
	buildReferenceDriverSupplyMap,
} from "@refarm.dev/cli/capability-index";

const index = buildRefarmCapabilityIndex();
const referenceDriverSupply = buildReferenceDriverSupplyMap();
```

The CLI exposes the same static posture for agents and downstream scripts that
cannot import the package yet:

```bash
refarm capabilities --tag reference-driver --supply reference-driver --json
```

The supply map is intentionally conservative. Today it marks
`@refarm.dev/cli/capability-index` as the exported discovery SDK, exposes
`@refarm.dev/cli/interaction-driver` for ask-loop promotion readiness, exposes
`@refarm.dev/cli` as the plan-only worker descriptor/readiness/result SDK,
keeps `@refarm.dev/pi-agent` publication on hold while the plugin package is
private, and records `agent-tools`, plugin WIT, and Tractor code-ops as
WIT/runtime/crate boundaries rather than pretending they are ready npm APIs.
The narrower `@refarm.dev/cli/worker-profile` subpath remains available for
consumers that want only the worker contract.

`@refarm.dev/cli/interaction-driver` describes the local ask loop as an
embeddable interaction contract and reports why gateway/RPC promotion remains
blocked. It does not call a provider, start a runtime, or depend on any app
shell.

`@refarm.dev/cli` and `@refarm.dev/cli/worker-profile` expose the first
"agents as tools" contract. `createWorkerProfile()` defines the bounded worker,
and `createWorkerToolDescriptor()` wraps it as a plan-only tool descriptor with
explicit model scope, token source, max turns, and max concurrency. Runtime
dispatch is intentionally rejected until the worker engine has policy,
cancellation, observability, and cost-control proofs.

```ts
import {
	assessWorkerToolReadiness,
	createWorkerProfile,
	createWorkerToolDescriptor,
	createWorkerToolResult,
	validateWorkerToolResult,
} from "@refarm.dev/cli";

const profile = createWorkerProfile({
	id: "worker.plan-review",
	title: "Plan Review Worker",
	description: "Review a plan and return a compact risk summary.",
	objective: "Find risks before implementation starts.",
	allowedTools: ["read", "search"],
	output: { format: "json", requiredFields: ["summary", "risks"] },
});

const descriptor = createWorkerToolDescriptor(profile, {
	name: "worker.planReview",
	inputFields: ["task", "scope"],
});

const readiness = assessWorkerToolReadiness(descriptor);
if (!readiness.ok) {
	throw new Error(readiness.issues.join("; "));
}

const result = createWorkerToolResult(descriptor, {
	summary: "Plan is bounded; rollback evidence is missing.",
	output: {
		summary: "Plan is bounded.",
		risks: ["Missing rollback evidence."],
	},
});

validateWorkerToolResult(descriptor, result);
```

Consumers can call `assessWorkerToolReadiness()` to get structured blockers
instead of parsing validation strings when deciding whether to expose a worker
as a real tool. Each blocker includes a `proofTarget` so downstream tools can
show the missing policy, cancellation, observability, or cost-control proof
without inventing their own checklist. `createWorkerToolResult()` and
`validateWorkerToolResult()` define the matching return envelope: workers must
return a compact summary, satisfy the descriptor's declared output fields when
completed, and explain blocked, failed, or cancelled statuses through `issues`.
