const SESSION_SCOPE = "session";
const GIT_SCOPE = "git";

export const REFARM_TREE_SCHEMA_VERSION = 1;
export const REFARM_TREE_SESSION_SCOPE = SESSION_SCOPE;
export const REFARM_TREE_GIT_SCOPE = GIT_SCOPE;

export type RefarmTimelineScope = typeof SESSION_SCOPE | typeof GIT_SCOPE;

export interface RefarmTimelineNode {
	timelineId: RefarmTimelineScope;
	nodeId: string;
	parentNodeId?: string;
	branchId?: string;
	kind: RefarmTimelineScope;
	label: string;
	timestamp: string;
	metadata: {
		shortId: string;
		leafEntryId?: string | null;
		hasHistory?: boolean;
		refs?: string[];
	};
}

export interface RefarmTimelineListEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: RefarmTimelineScope;
	operation: "list";
	nodes: RefarmTimelineNode[];
}

export interface RefarmTimelineShowEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: RefarmTimelineScope;
	operation: "show";
	node: RefarmTimelineNode;
}

export interface RefarmSessionTimelineShowEnvelope
	extends RefarmTimelineShowEnvelope {
	scope: typeof REFARM_TREE_SESSION_SCOPE;
	entries: unknown[];
	total: number;
}

export interface RefarmSessionTimelinePreviewPlan {
	kind: "session-fork";
	destructive: false;
	branchPointEntryId: string | null;
	recommendedCommand: string;
}

export interface RefarmGitTimelinePreviewPlan {
	kind: "git-branch";
	destructive: false;
	worktreeSwitched: false;
	baseCommit: string;
	recommendedCommand: string;
}

export interface RefarmTimelinePreviewEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: RefarmTimelineScope;
	operation: "preview";
	reason: "dry-run";
	target: RefarmTimelineNode;
	plan: RefarmSessionTimelinePreviewPlan | RefarmGitTimelinePreviewPlan;
}

export interface RefarmGitTimelineForkResult {
	kind: "git-branch";
	destructive: false;
	worktreeSwitched: false;
	currentRefBefore: string;
	currentRefAfter: string;
	branchName: string;
	baseCommit: string;
	command: string;
}

export interface RefarmTimelineForkEnvelope {
	schemaVersion: typeof REFARM_TREE_SCHEMA_VERSION;
	command: "tree";
	scope: RefarmTimelineScope;
	operation: "fork";
	reason: "executed";
	target: RefarmTimelineNode;
	result: RefarmGitTimelineForkResult;
}

export function outputTreeJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}
