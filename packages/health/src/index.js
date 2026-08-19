/**
 * HealthCore: generic health orchestrator.
 * Acts as a registry for multiple health auditors (Project, User, Org).
 * Supports stratified auditing where layers can build on each other.
 */
export class HealthCore {
	#auditors = new Map();
	/** @type {{ getNode?: (id: string) => Promise<unknown>, queryNode?: (id: string) => Promise<unknown> } | null} */
	#graphContext = null;

	/**
	 * @param {{ getNode?: (id: string) => Promise<unknown>, queryNode?: (id: string) => Promise<unknown> } | null} [graphContext]
	 *   A read face over the graph (getNode/queryNodes). Null → graph-dependent
	 *   auditors no-op.
	 */
	constructor(graphContext = null) {
		this.#graphContext = graphContext;
	}

	/**
	 * Registers a new specialized health auditor.
	 */
	register(auditor) {
		if (!auditor.id) throw new Error("Auditor must have a unique 'id' field.");
		this.#auditors.set(auditor.id, auditor);
	}

	/**
	 * Loads a health policy from an external graph context to guide auditors.
	 * Positioned for future use where policies are encoded as graph nodes.
	 */
	async loadPolicy(policyNodeId) {
		if (!this.#graphContext) {
			console.warn(`[Health] Cannot load policy ${policyNodeId}: No Graph Context provided.`);
			return null;
		}

		try {
			// Mocking graph fetch for now - in full implementation,
			// this would use the real Tractor/Graph query engine.
			const policyNode = await this.#graphContext.queryNode(policyNodeId);
			return policyNode?.healthPolicy || null;
		} catch (e) {
			console.error(`[Health] Failed to fetch policy ${policyNodeId}: ${e.message}`);
			return null;
		}
	}

	/**
	 * Runs all registered auditors or a specific subset in a stratified sequence.
	 */
	async audit(requestedAuditors = null, policyId = null, options = {}) {
		const results = {};
		const policy = policyId ? await this.loadPolicy(policyId) : null;

		const context = {
			rootDir: options.rootDir || process.cwd(),
			// The base ConfigNodeAuditor reads the local .refarm/config.json from —
			// the scope the graph node's OWNING DAEMON used, which is not always
			// `rootDir` (a bare `process.cwd()`/project root, e.g. a repository
			// checkout, is very often NOT where the running node was started).
			// Callers that know the node's declared base (see
			// apps/refarm/src/commands/health.ts) pass it explicitly; when they
			// don't, ConfigNodeAuditor falls back to `rootDir` itself so a direct,
			// single-root unit test keeps working unchanged.
			configBase: options.configBase,
			timestamp: new Date().toISOString(),
			policy: policy || {}, // Inject policy into the context
		};

		const targets = requestedAuditors
			? requestedAuditors.map((id) => this.#auditors.get(id)).filter(Boolean)
			: Array.from(this.#auditors.values());

		for (const auditor of targets) {
			const auditorResult = await auditor.audit(context);
			results[auditor.id] = auditorResult;
			context[auditor.id] = auditorResult;
		}

		if (results.project) {
			const projectResult = {
				...results.project,
				_orchestrator: results,
				_policy: policy,
			};
			if (results.complexity) {
				projectResult.complexity = results.complexity.blockingFindings || [];
				projectResult.complexitySummary = results.complexity;
			}
			return projectResult;
		}

		return results;
	}

	/**
	 * Helper for backward compatibility.
	 */
	// os-resolution: project — audits the resolution state of the repository being inspected
	async checkResolutionStatus(rootDir = process.cwd()) {
		const projectAuditor = this.#auditors.get("project");
		if (!projectAuditor) return [];
		return await projectAuditor.checkResolutionStatus(rootDir);
	}
}

import { FileSystemAuditor } from "./auditors/generic.js";
import { ProjectAuditor, RefarmProjectAuditor } from "./auditors/project.js";
import { ComplexityAuditor } from "./auditors/complexity.js";
import { ToolchainAuditor } from "./auditors/toolchain.js";
import { ConfigNodeAuditor } from "./auditors/config-node.js";
export { detectProjectBase } from "./project-base.js";
export { describeSubstrate, readNodeSubstrate } from "./node-substrate.js";
/** @typedef {import("./node-substrate.js").NodeSubstrate} NodeSubstrate */
export {
	describeRenewalCoverage,
	EXPIRING_PROVIDERS,
	renewalCoverage,
} from "./credential-renewal.js";
export {
	compareVersions,
	explainToolRequirement,
	parseToolVersion,
	readToolRequirements,
	toolRequirementState,
} from "./tool-requirements.js";
export { describeMeasurement, measureTool, proposedFloor } from "./tool-measurement.js";
export {
	buildSessionPressureBudget,
	buildEnvironmentPressureReport,
	bytesToMiB,
	classifyDiskPressure,
	classifyMemoryPressure,
	decideEnvironmentPressure,
	planEnvironmentWorkCeiling,
	DEFAULT_ENVIRONMENT_PRESSURE_THRESHOLDS,
} from "./environment-pressure.js";

export {
	ComplexityAuditor,
	ConfigNodeAuditor,
	FileSystemAuditor,
	ProjectAuditor,
	RefarmProjectAuditor,
	ToolchainAuditor,
};
