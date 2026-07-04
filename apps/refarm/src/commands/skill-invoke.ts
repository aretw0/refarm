import {
	buildSkillInvocationDecision,
	buildSkillInvocationRequest,
	prepareSkillInvocationPlan,
	type SkillInvocationDecisionV1,
	type SkillInvocationPlanV1,
	type SkillInvocationRequestV1,
	type SkillManifestIssue,
} from "@refarm.dev/skill-contract-v1";

export type { SkillInvocationDecisionV1 } from "@refarm.dev/skill-contract-v1";

/**
 * The skill INVOCATION loop — plan → request → decision, plus persistence of the
 * decision. Deliberately NOT coupled to the `skill` command or to app domain:
 * every host touch (reading the SKILL.md source, persisting the decision, the
 * clock) is INJECTED, so the same loop drives the CLI `skill invoke`, a plugin, a
 * daemon, or any other packageable perspective that wants the approval gate. The
 * contract stays plan-only/approval-gated — this produces a Decision (approved or
 * denied, with per-capability grants), never a Receipt: there is no runtime
 * dispatch here, so a skill is never executed by this loop.
 */

/** Where the SKILL.md text comes from — injected so a host can read a directory,
 * an OPFS entry, a content-addressed asset, or a peer without this loop knowing. */
export interface SkillInvocationSource {
	/** The raw SKILL.md text (frontmatter + body) to plan an invocation from. */
	read(): Promise<string> | string;
	/** A label for the source (a path, a urn) used only in messages/persistence. */
	label: string;
}

/** The host-supplied decision — whether to approve, why, and which capabilities
 * are granted. Mirrors the contract's SkillInvocationDecisionOptions but is the
 * host's INTENT before the loop validates it against the request. */
export interface SkillInvocationApproval {
	decision: "approved" | "denied";
	reason: string;
	/** Required for an approval: the capability ids the host grants. */
	approvedCapabilities?: readonly string[];
}

/** Persist a built decision — injected (a scoped ledger, a remote store, a peer).
 * The loop hands over a validated Decision; the host decides where it lives. */
export type SkillInvocationDecisionSink = (
	decision: SkillInvocationDecisionV1,
	source: SkillInvocationSource,
) => Promise<void> | void;

export interface SkillInvokeDeps {
	/** Persist an approved/denied decision. Omit for a dry plan-only run. */
	persistDecision?: SkillInvocationDecisionSink;
}

export interface SkillInvokeResult {
	ok: boolean;
	/** The invocation plan (what the skill would run + capabilities it needs). */
	plan: SkillInvocationPlanV1 | null;
	/** The request (plan + operator input), when planning succeeded. */
	request: SkillInvocationRequestV1 | null;
	/** The decision, when the host supplied an approval and it validated. */
	decision: SkillInvocationDecisionV1 | null;
	/** True when a decision was persisted via the injected sink. */
	persisted: boolean;
	issues: readonly SkillManifestIssue[];
}

/**
 * Run the invocation loop over one source. Always plans + builds the request
 * (read-only: "what would run, and which capabilities need approval"). If
 * `approval` is given, it also builds the decision (the approval gate) and
 * persists it through the injected sink. Never executes the skill.
 */
export async function runSkillInvocation(
	source: SkillInvocationSource,
	input: string,
	deps: SkillInvokeDeps = {},
	approval?: SkillInvocationApproval,
): Promise<SkillInvokeResult> {
	const text = await source.read();

	const prepared = prepareSkillInvocationPlan(text);
	if (!prepared.ok || !prepared.plan) {
		return {
			ok: false,
			plan: null,
			request: null,
			decision: null,
			persisted: false,
			issues: prepared.issues,
		};
	}

	// The PLAN needs no input — it is "what this skill would run + which
	// capabilities it needs". A REQUEST binds an input body, which the contract
	// requires to be non-empty, so a request (and thus a decision) is only built
	// once an input is supplied. A no-input call is a pure plan preview.
	if (!input.trim()) {
		return {
			ok: true,
			plan: prepared.plan,
			request: null,
			decision: null,
			persisted: false,
			issues: [],
		};
	}

	const built = buildSkillInvocationRequest(prepared.plan, input);
	if (!built.ok || !built.request) {
		return {
			ok: false,
			plan: prepared.plan,
			request: null,
			decision: null,
			persisted: false,
			issues: built.issues,
		};
	}

	// Plan-only path: no approval → report what would run + the gate, stop here.
	if (!approval) {
		return {
			ok: true,
			plan: prepared.plan,
			request: built.request,
			decision: null,
			persisted: false,
			issues: [],
		};
	}

	const decided = buildSkillInvocationDecision(built.request, {
		decision: approval.decision,
		reason: approval.reason,
		...(approval.approvedCapabilities
			? { approvedCapabilities: approval.approvedCapabilities }
			: {}),
	});
	if (!decided.ok || !decided.decision) {
		return {
			ok: false,
			plan: prepared.plan,
			request: built.request,
			decision: null,
			persisted: false,
			issues: decided.issues,
		};
	}

	let persisted = false;
	if (deps.persistDecision) {
		await deps.persistDecision(decided.decision, source);
		persisted = true;
	}

	return {
		ok: true,
		plan: prepared.plan,
		request: built.request,
		decision: decided.decision,
		persisted,
		issues: [],
	};
}
