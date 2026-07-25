export type {
	AccessDecision,
	AccessDenialReason,
	AccessPolicy,
	Membership,
	Workspace,
	WorkspaceKind,
} from "./types.js";
export { WORKSPACE_ACCESS_CONTRACT_VERSION } from "./types.js";
export { resolveAccess, validatePolicy, workspacesFor } from "./policy.js";
