import {
	CAPABILITIES,
	REFERENCE_DRIVER_ADOPTION_CRITERIA,
	REFERENCE_DRIVER_LESSONS,
	REFERENCE_DRIVER_PROMOTION_PROOF_TARGETS,
	REFERENCE_DRIVER_PUBLICATION_BOUNDARY,
	REFERENCE_DRIVER_SOURCE_REFERENCES,
	REFERENCE_DRIVER_SUPPLY_TARGETS,
} from "./capability-index-data.js";
import type {
	InteractionDriverEventName,
	InteractionDriverTerminalEventName,
} from "./interaction-driver.js";
import {
	WORKER_PROFILE_MAX_PARALLEL,
	WORKER_TOOL_MAX_TURNS,
} from "./worker-profile.js";

export const CAPABILITY_INDEX_SCHEMA_VERSION = 1 as const;

export type CapabilityProviderKind =
	| "cli"
	| "sdk"
	| "runtime"
	| "policy"
	| "ui";

export type CapabilityPolicyState =
	| "planned"
	| "governed"
	| "proven";

export interface CapabilityProvider {
	kind: CapabilityProviderKind;
	package?: string;
	surface?: string;
}

export interface CapabilityActivation {
	command?: string;
	sdk?: string;
}

export interface CapabilityPolicy {
	state: CapabilityPolicyState;
	enforcement: readonly string[];
	evidence: readonly string[];
}

export interface CapabilityDescriptor {
	id: string;
	title: string;
	description: string;
	provider: CapabilityProvider;
	requirements: readonly string[];
	policy: CapabilityPolicy;
	activation: CapabilityActivation;
	tags: readonly string[];
}

export interface CapabilityIndex {
	schemaVersion: typeof CAPABILITY_INDEX_SCHEMA_VERSION;
	capabilities: readonly CapabilityDescriptor[];
}

export type CapabilitySupplyChannel =
	| "npm"
	| "crate"
	| "wit"
	| "runtime";

export type CapabilitySupplyStatus =
	| "exported"
	| "candidate"
	| "internal"
	| "hold";

export interface CapabilitySupplyTarget {
	channel: CapabilitySupplyChannel;
	name: string;
	export?: string;
	path?: string;
	eventContract?: {
		format: "json-events";
		requiredEvents: readonly InteractionDriverEventName[];
		terminalEvents: readonly InteractionDriverTerminalEventName[];
	};
	budgetContract?: {
		tokenUse: "provider";
		maxTurns: typeof WORKER_TOOL_MAX_TURNS;
		maxParallel: typeof WORKER_PROFILE_MAX_PARALLEL;
		stopConditionRequired: true;
	};
	status: CapabilitySupplyStatus;
	note: string;
}

export interface ReferenceDriverSourceReference {
	name: string;
	url: string;
}

export interface ReferenceDriverAdoptionCriterion {
	id: string;
	title: string;
	requirement: string;
	proof: string;
	consumerBoundary: string;
}

export interface ReferenceDriverPublicationBoundary {
	discoveryPackage: "@refarm.dev/cli";
	discoverySubpath: "@refarm.dev/cli/capability-index";
	publicationState: "boundary-review";
	consumerInstallPolicy: "not-vault-seed-ready";
	runtimeExecutionState: "private";
	note: string;
}

export interface ReferenceDriverSupplyEntry {
	capabilityId: string;
	provider: CapabilityProvider;
	policyState: CapabilityPolicyState;
	activation: CapabilityActivation;
	referenceSources: readonly ReferenceDriverSourceReference[];
	referenceLessons: readonly string[];
	promotionProofTargets: readonly string[];
	targets: readonly CapabilitySupplyTarget[];
	nextDecision: string;
}

export interface ReferenceDriverSupplyMap {
	schemaVersion: typeof CAPABILITY_INDEX_SCHEMA_VERSION;
	discoverySdk: "@refarm.dev/cli/capability-index";
	smokeCommand: "pnpm run reference-driver:smoke";
	publicationBoundary: ReferenceDriverPublicationBoundary;
	adoptionCriteria: readonly ReferenceDriverAdoptionCriterion[];
	entries: readonly ReferenceDriverSupplyEntry[];
}

export interface ReferenceDriverSupplyPreflightTarget extends CapabilitySupplyTarget {
	capabilityId: string;
	promotionProofTargets: readonly string[];
}

export interface ReferenceDriverSupplyPreflightSummary {
	status: Exclude<CapabilitySupplyStatus, "exported">;
	count: number;
}

export interface ReferenceDriverSupplyPreflightProofSummary {
	blockedTargetCount: number;
	targetsWithPromotionProofTargets: number;
	uniquePromotionProofTargetCount: number;
	targetsWithBudgetContract: number;
}

export interface ReferenceDriverSupplyPromotionQueueItem {
	rank: number;
	capabilityId: string;
	status: Exclude<CapabilitySupplyStatus, "exported">;
	channel: CapabilitySupplyChannel;
	name: string;
	proofTargetCount: number;
	hasBudgetContract: boolean;
	nextDecision: string;
}

export interface ReferenceDriverSupplyPreflight {
	schemaVersion: typeof CAPABILITY_INDEX_SCHEMA_VERSION;
	source: "@refarm.dev/cli/capability-index";
	mode: "plan-only";
	publicationBoundary: ReferenceDriverPublicationBoundary;
	adoptionCriteria: readonly ReferenceDriverAdoptionCriterion[];
	targets: readonly ReferenceDriverSupplyPreflightTarget[];
	summary: readonly ReferenceDriverSupplyPreflightSummary[];
	proofSummary: ReferenceDriverSupplyPreflightProofSummary;
	promotionQueue: readonly ReferenceDriverSupplyPromotionQueueItem[];
	nextDecisions: readonly {
		capabilityId: string;
		nextDecision: string;
	}[];
}

export function buildCapabilityIndex(): CapabilityIndex {
	return {
		schemaVersion: CAPABILITY_INDEX_SCHEMA_VERSION,
		capabilities: CAPABILITIES,
	};
}

export function getCapabilityDescriptors(): readonly CapabilityDescriptor[] {
	return CAPABILITIES;
}

export function buildReferenceDriverSupplyMap(): ReferenceDriverSupplyMap {
	const descriptors = CAPABILITIES as readonly CapabilityDescriptor[];
	return {
		schemaVersion: CAPABILITY_INDEX_SCHEMA_VERSION,
		discoverySdk: "@refarm.dev/cli/capability-index",
		smokeCommand: "pnpm run reference-driver:smoke",
		publicationBoundary: REFERENCE_DRIVER_PUBLICATION_BOUNDARY,
		adoptionCriteria: REFERENCE_DRIVER_ADOPTION_CRITERIA,
		entries: Object.entries(REFERENCE_DRIVER_SUPPLY_TARGETS).map(([id, supply]) => {
			const capability = descriptors.find((candidate) => candidate.id === id);
			if (!capability || !capability.tags.includes("reference-driver")) {
				throw new Error(`Reference-driver capability descriptor missing: ${id}`);
			}
			return {
				capabilityId: capability.id,
				provider: capability.provider,
				policyState: capability.policy.state,
				activation: capability.activation,
				referenceSources: REFERENCE_DRIVER_SOURCE_REFERENCES[id] ?? [],
				referenceLessons: REFERENCE_DRIVER_LESSONS[id] ?? [],
				promotionProofTargets:
					REFERENCE_DRIVER_PROMOTION_PROOF_TARGETS[id] ?? [],
				targets: supply.targets,
				nextDecision: supply.nextDecision,
			};
		}),
	};
}

export function buildReferenceDriverSupplyPreflight(): ReferenceDriverSupplyPreflight {
	const includedStatuses = ["candidate", "internal", "hold"] as const;
	const includedStatusSet = new Set<CapabilitySupplyStatus>(includedStatuses);
	const supplyMap = buildReferenceDriverSupplyMap();
	const targets = supplyMap.entries.flatMap((entry) =>
		entry.targets
			.filter((target) => includedStatusSet.has(target.status))
			.map((target) => ({
				capabilityId: entry.capabilityId,
				promotionProofTargets: entry.promotionProofTargets,
				...target,
			})),
	);
	const uniquePromotionProofTargets = new Set(
		targets.flatMap((target) => target.promotionProofTargets),
	);
	const nextDecisionByCapabilityId = new Map(
		supplyMap.entries.map((entry) => [entry.capabilityId, entry.nextDecision]),
	);
	const statusRank: Record<Exclude<CapabilitySupplyStatus, "exported">, number> = {
		candidate: 0,
		internal: 1,
		hold: 2,
	};
	const statusForQueue = (
		status: CapabilitySupplyStatus,
	): Exclude<CapabilitySupplyStatus, "exported"> => {
		if (status === "exported") {
			throw new Error("Reference-driver preflight queue cannot include exported targets");
		}
		return status;
	};
	const promotionQueue = [...targets]
		.sort(
			(left, right) =>
				statusRank[statusForQueue(left.status)] -
				statusRank[statusForQueue(right.status)],
		)
		.map((target, index) => {
			const status = statusForQueue(target.status);
			return {
				rank: index + 1,
				capabilityId: target.capabilityId,
				status,
				channel: target.channel,
				name: target.name,
				proofTargetCount: target.promotionProofTargets.length,
				hasBudgetContract: target.budgetContract !== undefined,
				nextDecision: nextDecisionByCapabilityId.get(target.capabilityId) ?? "",
			};
		});

	return {
		schemaVersion: CAPABILITY_INDEX_SCHEMA_VERSION,
		source: "@refarm.dev/cli/capability-index",
		mode: "plan-only",
		publicationBoundary: supplyMap.publicationBoundary,
		adoptionCriteria: supplyMap.adoptionCriteria,
		targets,
		summary: includedStatuses.map((status) => ({
			status,
			count: targets.filter((target) => target.status === status).length,
		})),
		proofSummary: {
			blockedTargetCount: targets.length,
			targetsWithPromotionProofTargets: targets.filter(
				(target) => target.promotionProofTargets.length > 0,
			).length,
			uniquePromotionProofTargetCount: uniquePromotionProofTargets.size,
			targetsWithBudgetContract: targets.filter(
				(target) => target.budgetContract !== undefined,
			).length,
		},
		promotionQueue,
		nextDecisions: supplyMap.entries.map((entry) => ({
			capabilityId: entry.capabilityId,
			nextDecision: entry.nextDecision,
		})),
	};
}
