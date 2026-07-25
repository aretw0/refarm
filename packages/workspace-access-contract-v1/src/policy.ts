import type { AccessDecision, AccessPolicy, Workspace } from "./types.js";

/** A namespace maps directly to a storage file, so it must be a safe token —
 * never a path, never `:memory:`. Lowercase alnum with dash/underscore, ≤64. */
const SAFE_NAMESPACE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Resolve which workspace (and namespace) an identity may act in. PURE — no I/O.
 *  - An unknown identity is denied: this is the gate's core "who are you".
 *  - A requested workspace must EXIST and the identity must be a MEMBER of it.
 *  - No workspace requested → the identity's single membership; if it has zero
 *    or several, deny (never guess a workspace when it's ambiguous).
 * The returned namespace is always the workspace's policy-defined one — a
 * client's requested id is only ever used to LOOK UP an allowed workspace,
 * never as a namespace itself.
 */
export function resolveAccess(
	policy: AccessPolicy,
	identity: string,
	requestedWorkspaceId?: string,
): AccessDecision {
	const membership = policy.memberships.find((m) => m.identity === identity);
	if (!membership) return { ok: false, reason: "unknown-identity" };
	const byId = new Map(policy.workspaces.map((w) => [w.id, w] as const));

	if (requestedWorkspaceId != null && requestedWorkspaceId !== "") {
		const workspace = byId.get(requestedWorkspaceId);
		if (!workspace) return { ok: false, reason: "workspace-not-found" };
		if (!membership.workspaces.includes(requestedWorkspaceId)) {
			return { ok: false, reason: "workspace-not-allowed" };
		}
		return { ok: true, workspace };
	}

	const allowed = workspacesFor(policy, identity);
	const only = allowed[0];
	if (allowed.length === 1 && only) return { ok: true, workspace: only };
	return { ok: false, reason: "no-default-workspace" };
}

/** The workspaces an identity may select — for a picker UI or an admin view. PURE. */
export function workspacesFor(policy: AccessPolicy, identity: string): Workspace[] {
	const membership = policy.memberships.find((m) => m.identity === identity);
	if (!membership) return [];
	const byId = new Map(policy.workspaces.map((w) => [w.id, w] as const));
	return membership.workspaces
		.map((id) => byId.get(id))
		.filter((w): w is Workspace => w != null);
}

/**
 * Structural + safety check of a policy before it's enforced. Returns the list
 * of problems (empty = valid). Enforced at load time, not per-request, so a
 * malformed policy fails loudly instead of silently mis-routing data.
 */
export function validatePolicy(policy: AccessPolicy): string[] {
	const errors: string[] = [];
	const ids = new Set<string>();
	for (const workspace of policy.workspaces) {
		if (ids.has(workspace.id)) errors.push(`duplicate workspace id: ${workspace.id}`);
		ids.add(workspace.id);
		if (!SAFE_NAMESPACE.test(workspace.namespace)) {
			errors.push(`unsafe namespace for ${workspace.id}: ${JSON.stringify(workspace.namespace)}`);
		}
	}
	for (const membership of policy.memberships) {
		for (const workspaceId of membership.workspaces) {
			if (!ids.has(workspaceId)) {
				errors.push(`membership ${membership.identity} references unknown workspace: ${workspaceId}`);
			}
		}
	}
	return errors;
}
