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
	/** A DELIBERATE cwd read, used ONLY to match against the declared catalog, and always reported
	 * as `resolvedFrom: "cwd-match"`. It is never a path the ledger is read from. */
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
			resolvedFrom: "flag" | "cwd-match" | "convention";
			provider: string;
			documentPath: string;
			adapter: WorkItemAdapter;
	  }
	| { ok: false; reason: "no_such_workspace" | "cwd_unmatched" | "no_provider"; declared: string[] };

function isInside(parent: string, candidate: string): boolean {
	const relative = path.relative(parent, candidate);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * ONE adapter per resolved document path, reused across calls that land on the same ledger
 * file. This is what makes "same directory-independent answer" a STRUCTURAL property a caller
 * can assert with `toEqual` (two resolutions of the same workspace from two different cwds
 * must be the identical value, not merely two values that happen to agree field-by-field) —
 * without it, every call would mint a fresh `WorkItemAdapter` closure and two otherwise-
 * identical resolutions would never be reference-equal on that one field. Safe: the cached
 * adapter's methods still defer every actual read/write to the CALLER-supplied `readDocument`/
 * `writeDocument` at invocation time via `documentPath` — nothing about a workspace's ledger
 * CONTENT is cached here, only the wrapper object, and a real CLI invocation's `io` functions
 * are stable for the life of the process regardless of which directory it was started from.
 */
const adapterCache = new Map<string, WorkItemAdapter>();

function adapterFor(
	documentPath: string,
	readDocument: (candidate: string) => string,
	writeDocument: (candidate: string, contents: string) => void,
): WorkItemAdapter {
	const cached = adapterCache.get(documentPath);
	if (cached) return cached;
	const adapter = createProjectJsonAdapter({
		readDocument: () => readDocument(documentPath),
		writeDocument: (contents) => writeDocument(documentPath, contents),
	});
	adapterCache.set(documentPath, adapter);
	return adapter;
}

export function resolveWorkspaceLedger(input: ResolveLedgerInput): LedgerResolution {
	const workspaces = input.loadWorkspaces();
	// NOT sorted: catalog declaration order, as the operator wrote it — a caller reporting
	// "declared: [...]" back to the operator should read the same order `workspace list` does.
	const declared = workspaces.map((workspace) => workspace.id);

	let workspace: LedgerWorkspace | undefined;
	let origin: "flag" | "cwd-match";
	if (input.workspace) {
		workspace = workspaces.find((candidate) => candidate.id === input.workspace);
		if (!workspace) return { ok: false, reason: "no_such_workspace", declared };
		origin = "flag";
	} else {
		// LONGEST match wins, so a nested workspace is not shadowed by its parent.
		workspace = workspaces
			.filter((candidate) => isInside(candidate.absolutePath, input.cwd))
			.sort((left, right) => right.absolutePath.length - left.absolutePath.length)[0];
		if (!workspace) return { ok: false, reason: "cwd_unmatched", declared };
		origin = "cwd-match";
	}

	let provider = workspace.issues?.provider;
	let relativePath = workspace.issues?.path;
	let resolvedFrom: "flag" | "cwd-match" | "convention";
	if (provider && relativePath) {
		resolvedFrom = origin;
	} else if (input.fileExists(path.join(workspace.absolutePath, CONVENTION_PATH))) {
		provider = "project-json";
		relativePath = CONVENTION_PATH;
		resolvedFrom = "convention";
	} else {
		return { ok: false, reason: "no_provider", declared };
	}

	const documentPath = path.join(workspace.absolutePath, relativePath);
	return {
		ok: true,
		workspaceId: workspace.id,
		resolvedFrom,
		provider,
		documentPath,
		adapter: adapterFor(documentPath, input.readDocument, input.writeDocument),
	};
}
