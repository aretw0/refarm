/**
 * workspace-access:v1 — who may act in which workspace, and the storage
 * namespace each workspace maps to.
 *
 * The generic authorization block the daemon's auth gate enforces and any
 * surface (enrollment, admin, the hub's workspace picker) reads. It sits ON TOP
 * of authentication: `identity:v1`'s `deriveFromSession` answers "who are you";
 * this answers "which workspace may that identity act in, and where does its
 * data live". Kept pure and language-neutral so the Rust gate implements the
 * SAME rules the TS reference resolver does — one contract, many surfaces.
 */

export const WORKSPACE_ACCESS_CONTRACT_VERSION = "workspace-access:v1";

/** A workspace is either one person's private space or a space several share. */
export type WorkspaceKind = "personal" | "collective";

export interface Workspace {
	/** Stable id, e.g. "personal-arthur" or "collective-casa". */
	id: string;
	kind: WorkspaceKind;
	/** The storage namespace this workspace maps to (the daemon opens {namespace}.db).
	 * ALWAYS policy-defined — never a client-supplied string (that would be a DB-path
	 * injection). Validated by validatePolicy. */
	namespace: string;
	displayName?: string;
}

/** Which workspaces an identity may act in. */
export interface Membership {
	/** The identity id — from identity:v1 (deriveFromSession → identity.id). */
	identity: string;
	/** Workspace ids this identity may select. */
	workspaces: string[];
}

export interface AccessPolicy {
	workspaces: Workspace[];
	memberships: Membership[];
}

/** Why access was denied — the vocabulary the daemon's 401 body speaks. */
export type AccessDenialReason =
	| "unknown-identity"
	| "workspace-not-found"
	| "workspace-not-allowed"
	| "no-default-workspace";

export type AccessDecision =
	| { ok: true; workspace: Workspace }
	| { ok: false; reason: AccessDenialReason };
