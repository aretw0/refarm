const SESSION_SCOPE = "session";
const GIT_SCOPE = "git";

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

export interface RefarmSessionTimelinePreviewPlan {
	kind: "session-fork";
	destructive: false;
	branchPointEntryId: string | null;
	recommendedCommand: string;
}

export interface RefarmGitTimelinePreviewPlan {
	kind: "git-branch";
	destructive: false;
	baseCommit: string;
	recommendedCommand: string;
}

export interface RefarmTimelinePreviewEnvelope {
	command: "tree";
	scope: RefarmTimelineScope;
	operation: "preview";
	reason: "dry-run";
	target: RefarmTimelineNode;
	plan: RefarmSessionTimelinePreviewPlan | RefarmGitTimelinePreviewPlan;
}

export function outputTreeJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}
