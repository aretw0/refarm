/**
 * HealthCore: generic health orchestrator.
 * Acts as a registry for multiple health auditors (Project, User, Org).
 * Supports stratified auditing where layers can build on each other.
 */
export class HealthCore {
    #auditors = new Map();
    #graphContext = null;

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
    async audit(requestedAuditors = null, policyId = null) {
        const results = {};
        const policy = policyId ? await this.loadPolicy(policyId) : null;

        const context = {
            rootDir: process.cwd(),
            timestamp: new Date().toISOString(),
            policy: policy || {} // Inject policy into the context
        };

        const targets = requestedAuditors
            ? requestedAuditors.map(id => this.#auditors.get(id)).filter(Boolean)
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
                _policy: policy
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
    async checkResolutionStatus() {
        const projectAuditor = this.#auditors.get("project");
        if (!projectAuditor) return [];
        return await projectAuditor.checkResolutionStatus(process.cwd());
    }
}

import { FileSystemAuditor } from "./auditors/generic.js";
import { ProjectAuditor, RefarmProjectAuditor } from "./auditors/project.js";
import { ComplexityAuditor } from "./auditors/complexity.js";

export { ComplexityAuditor, FileSystemAuditor, ProjectAuditor, RefarmProjectAuditor };
