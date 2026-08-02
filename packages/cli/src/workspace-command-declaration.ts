import path from "node:path";

export interface WorkspaceCommandDeclarationInput {
	name: string;
	argv: string[];
	cwd?: string;
	description?: string;
	/** Explicitly admit this named operation to enrolled-device surfaces. Default: local only. */
	remote?: boolean;
}

export interface WorkspaceCommandDeclarationProposal {
	name: string;
	entry: {
		run: string[];
		cwd?: string;
		description?: string;
		remote?: true;
	};
}

export class WorkspaceCommandDeclarationError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = "WorkspaceCommandDeclarationError";
	}
}

/**
 * Build one portable, shell-free workspace operation declaration.
 *
 * The consuming app owns prompts, consent and persistence. This SDK primitive owns the
 * interoperable boundary: a stable name, exact argv, and an optional cwd that cannot escape the
 * workspace. No shell string is accepted, so authoring cannot accidentally turn the operation
 * catalog into a remote shell.
 */
export function deriveWorkspaceCommandDeclaration(
	input: WorkspaceCommandDeclarationInput,
): WorkspaceCommandDeclarationProposal {
	const name = input.name.trim();
	if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
		throw new WorkspaceCommandDeclarationError(
			"workspace-command-invalid-name",
			"Workspace command name must use only letters, numbers, dot, underscore, or dash.",
		);
	}
	const argv = input.argv.filter((token) => typeof token === "string" && token.length > 0);
	if (argv.length === 0 || argv.length !== input.argv.length) {
		throw new WorkspaceCommandDeclarationError(
			"workspace-command-invalid-argv",
			"Workspace command argv must contain at least one non-empty token.",
		);
	}
	const cwd = input.cwd?.trim();
	if (cwd) {
		const normalized = path.normalize(cwd);
		if (path.isAbsolute(cwd) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
			throw new WorkspaceCommandDeclarationError(
				"workspace-command-cwd-escapes",
				"Workspace command cwd must stay inside the declared workspace.",
			);
		}
	}
	const description = input.description?.trim();
	return {
		name,
		entry: {
			run: [...argv],
			...(cwd ? { cwd: path.normalize(cwd) } : {}),
			...(description ? { description } : {}),
			...(input.remote === true ? { remote: true as const } : {}),
		},
	};
}
