import path from "node:path";
import type { WorkItemAdapter } from "./contract.js";
import { createProjectJsonAdapter } from "./project-json-adapter.js";

const CONVENTION_PATH = ".project/issues.json";

export interface LedgerWorkspace {
	id: string;
	absolutePath: string;
	issues: { provider: string; path: string } | null;
}

export interface ResolveLedgerInput {
	workspace?: string;
	/** Set by a caller resolving `workspace` on behalf of a BATCH enumeration
	 * (`--all-workspaces`), where every declared id is looked up in turn rather than one
	 * operator-typed `--workspace <id>` flag. Reported as `workspaceFrom: "enumerated"` instead of
	 * `"flag"` — without this, the resolver cannot tell the two apart, because both arrive here as
	 * the same populated `workspace` string. Ignored when `workspace` is unset. */
	enumerated?: boolean;
	/** A DELIBERATE cwd read, used ONLY to match against the declared catalog, and always reported
	 * as `workspaceFrom: "cwd-match"`. It is never a path the ledger is read from. */
	cwd: string;
	loadWorkspaces: () => LedgerWorkspace[];
	fileExists: (candidate: string) => boolean;
	readDocument: (candidate: string) => string;
	writeDocument: (candidate: string, contents: string) => void;
}

export type LedgerResolution =
	| {
			ok: true;
			workspaceId: string;
			/** How the WORKSPACE was selected — independent of how its provider was found (see
			 * `providerFrom`). `"enumerated"` is the `--all-workspaces` batch path: the caller
			 * looked up a declared id on the operator's behalf, not a flag the operator typed. */
			workspaceFrom: "flag" | "cwd-match" | "enumerated";
			/** How the work-item PROVIDER was found for the selected workspace — independent of
			 * `workspaceFrom`. A workspace chosen by cwd-match can still have a DECLARED provider,
			 * and a workspace chosen by flag can still fall back to the convention path; these two
			 * facts do not determine each other, so they are never folded into one field. */
			providerFrom: "declared" | "convention";
			provider: string;
			documentPath: string;
			adapter: WorkItemAdapter;
	  }
	| { ok: false; reason: "no_such_workspace" | "cwd_unmatched" | "no_provider"; declared: string[] };

function isInside(parent: string, candidate: string): boolean {
	const relative = path.relative(parent, candidate);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveWorkspaceLedger(input: ResolveLedgerInput): LedgerResolution {
	const workspaces = input.loadWorkspaces();
	// NOT sorted here: `declared` is reported exactly as `loadWorkspaces()` returned it. In
	// production that is already alphabetical — `declaredWorkspacesFromConfig` sorts by
	// `id.localeCompare` (packages/config/src/workspaces-config.js) — but that is the LOADER's
	// choice, not this resolver's; a caller supplying an unsorted catalog (as this file's own
	// unit tests do) sees its own order echoed back unmodified.
	const declared = workspaces.map((workspace) => workspace.id);

	let workspace: LedgerWorkspace | undefined;
	let workspaceFrom: "flag" | "cwd-match" | "enumerated";
	if (input.workspace) {
		workspace = workspaces.find((candidate) => candidate.id === input.workspace);
		if (!workspace) return { ok: false, reason: "no_such_workspace", declared };
		workspaceFrom = input.enumerated ? "enumerated" : "flag";
	} else {
		// LONGEST match wins, so a nested workspace is not shadowed by its parent.
		workspace = workspaces
			.filter((candidate) => isInside(candidate.absolutePath, input.cwd))
			.sort((left, right) => right.absolutePath.length - left.absolutePath.length)[0];
		if (!workspace) return { ok: false, reason: "cwd_unmatched", declared };
		workspaceFrom = "cwd-match";
	}

	let provider = workspace.issues?.provider;
	let relativePath = workspace.issues?.path;
	let providerFrom: "declared" | "convention";
	if (provider && relativePath) {
		providerFrom = "declared";
	} else if (input.fileExists(path.join(workspace.absolutePath, CONVENTION_PATH))) {
		provider = "project-json";
		relativePath = CONVENTION_PATH;
		providerFrom = "convention";
	} else {
		return { ok: false, reason: "no_provider", declared };
	}

	const documentPath = path.join(workspace.absolutePath, relativePath);
	return {
		ok: true,
		workspaceId: workspace.id,
		workspaceFrom,
		providerFrom,
		provider,
		documentPath,
		adapter: createProjectJsonAdapter({
			readDocument: () => input.readDocument(documentPath),
			writeDocument: (contents) => input.writeDocument(documentPath, contents),
		}),
	};
}
