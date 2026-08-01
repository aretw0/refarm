import { WORKSPACE_KINDS } from "@refarm.dev/config";
import fs from "node:fs";
import path from "node:path";

export interface WorkspaceDeclarationInput {
	id?: string;
	kind?: string;
	repository?: string;
}

export interface WorkspaceDeclarationProposal {
	id: string;
	entry: Record<string, unknown>;
	evidence: WorkspaceDeclarationEvidence[];
}

export interface WorkspaceDeclarationEvidence {
	key: "path" | "id" | "kind" | "repository";
	value: string;
	source: "host-path" | "package-name" | "directory-name" | "input" | "package" | "default" | "git-origin";
}

export class WorkspaceDeclarationError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = "WorkspaceDeclarationError";
	}
}

function normalizeWorkspaceId(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function readJson(candidate: string, readFile: (candidate: string) => string): Record<string, unknown> {
	try {
		const value = JSON.parse(readFile(candidate));
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function originUrl(workspacePath: string, readFile: (candidate: string) => string): string | null {
	try {
		const config = readFile(path.join(workspacePath, ".git", "config"));
		const section = config.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? "";
		return section.match(/^\s*url\s*=\s*(.+?)\s*$/m)?.[1]?.trim() ?? null;
	} catch {
		return null;
	}
}

function safeRepositoryUrl(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	try {
		const parsed = new URL(trimmed);
		if (parsed.username || parsed.password) {
			throw new WorkspaceDeclarationError(
				"workspace-repository-contains-credential",
				"The repository URL contains credentials. Use a credential-free URL; secrets must never enter a declaration or operation trail.",
			);
		}
	} catch (error) {
		if (error instanceof WorkspaceDeclarationError) throw error;
		// SCP-style Git URLs (git@host:owner/repo.git) are intentionally valid.
	}
	return trimmed;
}

/**
 * Derive the portable part of a workspace declaration from host observations.
 *
 * Brand, home policy, prompts, consent and writes belong to the consuming app.
 * This SDK primitive only builds data plus provenance, and accepts file reading
 * as a seam so non-Node hosts can supply an equivalent observer.
 */
export function deriveWorkspaceDeclaration(
	workspacePath: string,
	input: WorkspaceDeclarationInput = {},
	readFile: (candidate: string) => string = (candidate) => fs.readFileSync(candidate, "utf8"),
): WorkspaceDeclarationProposal {
	if (!path.isAbsolute(workspacePath)) {
		throw new WorkspaceDeclarationError(
			"workspace-path-not-absolute",
			`Workspace path must be absolute: ${JSON.stringify(workspacePath)}`,
		);
	}
	const packageJson = readJson(path.join(workspacePath, "package.json"), readFile);
	const packageName = typeof packageJson.name === "string" ? packageJson.name : "";
	const id = normalizeWorkspaceId(
		input.id || packageName.replace(/^@[^/]+\//, "") || path.basename(workspacePath),
	);
	if (!id) {
		throw new WorkspaceDeclarationError("workspace-invalid-id", "Workspace id must not be blank.");
	}
	const inferredKind = packageName === "refarm" ? "refarm" : "project";
	const kind = input.kind ?? inferredKind;
	if (!WORKSPACE_KINDS.includes(kind)) {
		throw new WorkspaceDeclarationError(
			"workspace-invalid-kind",
			`Unknown workspace kind ${JSON.stringify(kind)}; use ${WORKSPACE_KINDS.join(", ")}.`,
		);
	}
	const repository = safeRepositoryUrl(input.repository || originUrl(workspacePath, readFile));
	return {
		id,
		entry: {
			path: workspacePath,
			kind,
			execution: { preferredAdapter: "auto" },
			...(repository ? { repository: { url: repository } } : {}),
		},
		evidence: [
			{ key: "path", value: workspacePath, source: "host-path" },
			{ key: "id", value: id, source: packageName ? "package-name" : "directory-name" },
			{ key: "kind", value: kind, source: input.kind ? "input" : packageName === "refarm" ? "package" : "default" },
			...(repository
				? [{ key: "repository" as const, value: repository, source: input.repository ? "input" as const : "git-origin" as const }]
				: []),
		],
	};
}
