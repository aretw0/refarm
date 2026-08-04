import type { CapabilityDescriptor } from "@refarm.dev/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";

import {
	buildDispatchEffort,
	parseDispatchArgs,
	type SubmitEffort,
} from "@refarm.dev/capability-host";
import type { Effort } from "@refarm.dev/effort-contract-v1";
import { submitEffortViaSidecar } from "./dispatch-submit.js";

/**
 * `refarm dispatch <plugin> <verb> [key=value...]` — the ONE operator command to
 * dispatch a verb to ANY loaded plugin, the CLI mirror of the generic e2e harness
 * (one path for every plugin, not one command per plugin). It submits an effort to
 * the runtime; the sidecar routes the non-`respond` fn to the target plugin via
 * the neutral event router, and the async result lands as a dispatch-result:v1
 * node keyed by the returned effort id.
 *
 * Args are `key=value` pairs, each value parsed as JSON when it parses (so
 * `note={"path":"x"}` and `limit=5` become structured), else kept as a string.
 * Deps (submit, id, clock) are injected so run() is testable without a daemon.
 *
 * `--budget-deadline-ms` / `--budget-max-tokens` / `--budget-max-usd` let the
 * spawner declare this dispatch's own budget (Task 5's `Effort.budget`, resolved
 * against the workspace/node ceilings by `resolve_budget` on the node side) —
 * "whoever spawns declares," finally reachable from the surface an operator
 * actually types instead of only by hand-crafting HTTP. All three are optional;
 * omitting all three sends no `budget` field at all. See `parseBudgetOptions`.
 *
 * `--workspace <id>` binds this dispatch to a declared workspace — the missing half of D9's
 * middle level (`budget.workspaces.<id>` in the sovereign config), which `resolve_budget` has
 * always been able to fold but nothing ever set `Effort.workspaceId` to make reachable. Declared,
 * never detected: there is no cwd fallback, on purpose (see `parseWorkspaceOption`). Omitting the
 * flag sends no `workspaceId` field at all, so the wire stays byte-identical to today's dispatch.
 */
export interface DispatchCommandDeps {
	submitEffort: SubmitEffort;
	newId: () => string;
	nowIso: () => string;
}

export function defaultDispatchDeps(): DispatchCommandDeps {
	return {
		submitEffort: submitEffortViaSidecar,
		newId: () => crypto.randomUUID(),
		nowIso: () => new Date().toISOString(),
	};
}

// `parseDispatchArgs` is exposed through the host-facing plugin bridge;
// re-exported here so existing app consumers import it from this module unchanged.
export { parseDispatchArgs };

/**
 * The wire shape Task 5 put on `Effort.budget` — `{deadlineMs?, maxTokens?, maxUsd?}`,
 * camelCase, every axis optional. Redeclared locally instead of importing
 * `@refarm.dev/budget-contract-v1`: this file's dependency footprint stays exactly what
 * dispatch already needed (`@refarm.dev/effort-contract-v1`), since this is a stable wire
 * boundary, not a resolution detail that package owns.
 */
export type BudgetDeclaration = {
	deadlineMs?: number;
	maxTokens?: number;
	maxUsd?: number;
};

/** An Effort carrying the optional budget a spawner declared, and/or the workspace it was
 *  dispatched from — a local augmentation of the shared `Effort` type (which declares neither
 *  field), never a change to it. `workspaceId` mirrors the sidecar's own `Effort.workspace_id`
 *  (`packages/tractor/src/sidecar/mod.rs`), the wire's camelCase spelling of the same field. */
type DispatchEffort = Effort & { budget?: BudgetDeclaration; workspaceId?: string };

const BUDGET_OPTION_FIELDS: ReadonlyArray<{ flag: string; key: keyof BudgetDeclaration }> = [
	{ flag: "budget-deadline-ms", key: "deadlineMs" },
	{ flag: "budget-max-tokens", key: "maxTokens" },
	{ flag: "budget-max-usd", key: "maxUsd" },
];

/**
 * Parse the three `--budget-*` flags into the wire's `BudgetDeclaration` shape. PURE —
 * reads only the already-parsed `CapabilityInput.options`, the ONE place this repo's CLI
 * surface validates a declared budget, so a later second call site (the REPL, an agent
 * tool) reuses this instead of re-implementing the same numeric check with different rules.
 *
 * Absent means absent: a flag the operator never passed produces no key at all (never `0`,
 * never `null`) — `budget` itself comes back `undefined` when all three are absent, so the
 * caller can skip attaching the field entirely and the wire stays byte-identical to a
 * dispatch that declares nothing.
 *
 * A present value must be a finite, non-negative number; **zero is accepted** as a
 * legitimate declaration — the node's own resolution (`resolve_budget`) treats a present
 * zero as a real ceiling, never as "nothing declared," so rejecting it here would make the
 * surface lie about what the node can express. Only a non-numeric or negative value is
 * rejected, named by its flag, before anything is built or dispatched.
 */
export function parseBudgetOptions(
	options: Record<string, string | string[] | boolean>,
): { budget?: BudgetDeclaration } | { error: string } {
	const budget: BudgetDeclaration = {};
	for (const { flag, key } of BUDGET_OPTION_FIELDS) {
		const raw = options[flag];
		if (raw === undefined) continue;
		if (typeof raw !== "string") {
			return { error: `--${flag} must be a number, got ${JSON.stringify(raw)}` };
		}
		const trimmed = raw.trim();
		const value = Number(trimmed);
		if (trimmed.length === 0 || !Number.isFinite(value)) {
			return { error: `--${flag} must be a number, got "${raw}"` };
		}
		if (value < 0) {
			return { error: `--${flag} must not be negative, got "${raw}"` };
		}
		budget[key] = value;
	}
	return Object.keys(budget).length > 0 ? { budget } : {};
}

/**
 * Parse `--workspace` into the wire's `workspaceId` — source #2 of the maintainer's ruling on
 * binding a budget to a workspace: "declared, never detected. No cwd fallback." `refarm dispatch`
 * never infers a workspace from the operator's current directory (the field failure that ruling
 * exists to prevent — `docs/superpowers/specs/2026-08-03-declared-node-base-design.md`); it binds
 * ONLY what this flag names. Source #1 of the same ruling is operation-id extraction
 * (`workspaceIdFromOperationId` in `./remote-initiation.js`), for surfaces that address a
 * dispatch by a declared operation id rather than by plugin+verb; this flag is the other source,
 * for this one.
 *
 * Same "parse once, reuse, absent means absent" shape as {@link parseBudgetOptions}: a flag never
 * passed produces no key at all (never `""`, never a guess), so `run()` below can skip attaching
 * `workspaceId` entirely and the wire stays byte-identical to a dispatch that declares no
 * workspace. A present value must be non-empty after trimming and free of whitespace/colons — not
 * because either is unsafe on the wire, but because no id `workspaceRemoteOperationId` ever
 * builds contains either, so accepting one here would let the two declared sources describe two
 * different notions of "a workspace id."
 */
export function parseWorkspaceOption(
	options: Record<string, string | string[] | boolean>,
): { workspaceId?: string } | { error: string } {
	const raw = options.workspace;
	if (raw === undefined) return {};
	if (typeof raw !== "string") {
		return { error: `--workspace must be a workspace id, got ${JSON.stringify(raw)}` };
	}
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return { error: "--workspace must not be empty" };
	}
	if (/[\s:]/.test(trimmed)) {
		return {
			error: `--workspace must not contain whitespace or a colon, got ${JSON.stringify(raw)}`,
		};
	}
	return { workspaceId: trimmed };
}

export function createDispatchCapability(
	deps: DispatchCommandDeps = defaultDispatchDeps(),
): CapabilityDescriptor {
	return {
		name: "dispatch",
		summary: "Dispatch a verb to any loaded plugin via the runtime",
		args: [
			{ name: "plugin", required: true },
			{ name: "verb", required: true },
			{ name: "args", variadic: true },
		],
		options: [
			{
				name: "budget-deadline-ms",
				kind: "integer",
				summary:
					"Wall-clock deadline for the whole dispatch, in milliseconds (omit for the node default)",
			},
			{
				name: "budget-max-tokens",
				kind: "integer",
				summary: "Cumulative token ceiling across the dispatch (omit for the node default)",
			},
			{
				name: "budget-max-usd",
				kind: "number",
				summary:
					"Estimated spend ceiling in dollars (decimal; only binds under api pricing mode)",
			},
			{
				name: "workspace",
				kind: "string",
				summary:
					"Bind this dispatch to a declared workspace id, for budget.workspaces ceilings (omit for no workspace binding)",
			},
		],
		async run(input) {
			const pluginId = input.args.plugin as string;
			const verb = input.args.verb as string;
			const rawArgs = (input.args.args as string[] | undefined) ?? [];

			const parsed = parseDispatchArgs(rawArgs);
			if ("error" in parsed) {
				return buildJsonErrorEnvelope({
					command: "dispatch",
					operation: "dispatch",
					error: "invalid-args",
					message: parsed.error,
					nextAction: 'Pass args as key=value, e.g. `dispatch vault extract note={"path":"n.md"}`.',
				});
			}

			const parsedBudget = parseBudgetOptions(input.options);
			if ("error" in parsedBudget) {
				return buildJsonErrorEnvelope({
					command: "dispatch",
					operation: "dispatch",
					error: "invalid-args",
					message: parsedBudget.error,
					nextAction:
						"Pass a non-negative number, e.g. `--budget-deadline-ms 120000`. Omit a flag to leave that axis unset.",
				});
			}

			const parsedWorkspace = parseWorkspaceOption(input.options);
			if ("error" in parsedWorkspace) {
				return buildJsonErrorEnvelope({
					command: "dispatch",
					operation: "dispatch",
					error: "invalid-args",
					message: parsedWorkspace.error,
					nextAction: "Pass a bare workspace id, e.g. `--workspace rcdc5`. Omit the flag for no workspace binding.",
				});
			}

			const effort: DispatchEffort = buildDispatchEffort(
				{ pluginId, verb, args: parsed.args },
				deps.newId,
				deps.nowIso,
			);
			if (parsedBudget.budget) {
				effort.budget = parsedBudget.budget;
			}
			if (parsedWorkspace.workspaceId) {
				effort.workspaceId = parsedWorkspace.workspaceId;
			}

			try {
				const effortId = await deps.submitEffort(effort);
				return buildJsonSuccessEnvelope({
					command: "dispatch",
					operation: "dispatch",
					extra: {
						effortId,
						pluginId,
						verb,
						replyRef: effort.id,
					},
					nextAction: `The result will be stored as a dispatch-result node keyed by replyRef "${effort.id}".`,
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "dispatch",
					operation: "dispatch",
					error: "dispatch-failed",
					message: `Could not submit the dispatch: ${String(error)}`,
					nextAction:
						"Is the runtime daemon up? Run `refarm runtime status`. Is the plugin loaded and does its manifest declare subscribes:[<plugin>:dispatch]?",
				});
			}
		},
		transports: {
			cli: {},
			repl: {},
			http: { method: "POST", path: "/dispatch" },
		},
	};
}
