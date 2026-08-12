import {
	deriveWorkspaceDeclaration,
	WorkspaceDeclarationError,
	type WorkspaceDeclarationProposal,
} from "@refarm.dev/cli/workspace-declaration";
import { declaredWorkspacesFromConfig, WORKSPACE_KINDS } from "@refarm.dev/config";
import {
	createFileOperationTrail,
	createNodeOperationFileSystem,
	type OperationFileSystem,
	type OperationQuestion,
	type OperationTrail,
} from "@refarm.dev/operation-consent-v1";
import {
	createStdioOperatorChannel,
	OperatorPromptCancelledError,
	type OperatorChannel,
} from "@refarm.dev/prompt-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refarmCommand } from "../brand.js";
import { resolveRefarmHome } from "../utils/refarm-home.js";
import {
	authorCatalogDeclaration,
	buildCatalogOperationRequest,
	catalogConfigPath,
	catalogTrailPath,
	localWorkspaceDeclarationAbolishedMessage,
	planCatalogDeclaration,
	renderCatalogProposal,
	standingCatalogDecision,
} from "./catalog-authoring.js";

export const WORKSPACE_BLOCK = "workspaces" as const;
const WORKSPACE_ADD_COMMAND = refarmCommand(["workspace", "add"]);

export interface WorkspaceAddOptions {
	path?: string;
	id?: string;
	kind?: string;
	repository?: string;
	replace?: boolean;
	local?: boolean;
	attendedElsewhere?: boolean;
	json?: boolean;
}

export interface WorkspaceAddDeps {
	root?: string;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	interactive?: boolean;
	operator?: OperatorChannel;
	trail?: OperationTrail;
	fs?: OperationFileSystem;
	now?: () => string;
	decidedBy?: string;
	host?: string;
	exists?: (candidate: string) => boolean;
	isDirectory?: (candidate: string) => boolean;
	readFile?: (candidate: string) => string;
	announce?: (line: string) => void;
}

export type WorkspaceAddResult =
	| {
			status: "declared";
			workspace: string;
			entry: Record<string, unknown>;
			configPath: string;
			recordId: string;
			undoCommand: string;
			replaced: boolean;
	  }
	| { status: "declined" | "deferred"; workspace: string; recordId?: string }
	| { status: "cancelled"; workspace: string | null }
	| { status: "unchanged"; workspace: string; reason: "already-declared" | "already-decided" }
	/** Somebody is already waiting on this exact question — a run that asked and may be gone. */
	| { status: "already-asked"; workspace: string; question: OperationQuestion };

export class WorkspaceAddRefusal extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = "WorkspaceAddRefusal";
	}
}

function deriveWorkspaceProposal(
	workspacePath: string,
	options: Pick<WorkspaceAddOptions, "id" | "kind" | "repository">,
	readFile: (candidate: string) => string = (candidate) => fs.readFileSync(candidate, "utf8"),
): WorkspaceDeclarationProposal {
	try {
		return deriveWorkspaceDeclaration(workspacePath, options, readFile);
	} catch (error) {
		if (error instanceof WorkspaceDeclarationError) {
			throw new WorkspaceAddRefusal(`workspace-add-${error.code.replace(/^workspace-/, "")}`, error.message);
		}
		throw error;
	}
}

export async function runWorkspaceAdd(
	options: WorkspaceAddOptions,
	deps: WorkspaceAddDeps = {},
): Promise<WorkspaceAddResult> {
	// R2/R1 (docs/superpowers/specs/2026-08-06-a-workspace-is-not-a-node-design.md):
	// --local used to declare a workspace's EXISTENCE — path/kind/repository — inside
	// that workspace's own .refarm/config.json. That shape is abolished; refused before
	// any env/fs work happens, not redirected. See localWorkspaceDeclarationAbolishedMessage.
	if (options.local) {
		throw new WorkspaceAddRefusal(
			"workspace-add-local-abolished",
			localWorkspaceDeclarationAbolishedMessage(WORKSPACE_ADD_COMMAND),
		);
	}
	const env = deps.env ?? process.env;
	// os-resolution: process — resolves the path the operator typed, against where the operator typed it
	const cwd = deps.cwd ?? process.cwd();
	const operatorHome = path.resolve(resolveRefarmHome(env));
	const root = deps.root ?? path.dirname(operatorHome);
	const catalogEnv = deps.root ? env : { ...env, SOVEREIGN_DIR: path.basename(operatorHome) };
	const exists = deps.exists ?? fs.existsSync;
	const isDirectory =
		deps.isDirectory ??
		((candidate: string) => {
			try {
				return fs.statSync(candidate).isDirectory();
			} catch {
				return false;
			}
		});
	const readFile = deps.readFile ?? ((candidate: string) => fs.readFileSync(candidate, "utf8"));
	const say = deps.announce ?? ((line: string) => console.log(line));
	const interactive =
		deps.interactive ?? Boolean((process.stdin.isTTY && process.stdout.isTTY) || options.attendedElsewhere);
	if (!interactive) {
		throw new WorkspaceAddRefusal(
			"workspace-add-not-interactive",
			`Declaring a workspace is your authorisation, and there is nowhere to ask you. Run ${WORKSPACE_ADD_COMMAND} from an interactive surface.`,
		);
	}
	const operator = deps.operator ?? createStdioOperatorChannel();
	let id: string | null = null;
	try {
		let suppliedPath = options.path?.trim();
		if (!suppliedPath) {
			suppliedPath = (await operator.ask({
				type: "text",
				question: "Qual diretório deste workspace neste host?",
				default: cwd,
			})).trim();
		}
		const absolutePath = path.resolve(cwd, suppliedPath || ".");
		if (!exists(absolutePath) || !isDirectory(absolutePath)) {
			throw new WorkspaceAddRefusal(
				"workspace-add-missing-path",
				`Workspace path does not exist on this host: ${absolutePath}`,
			);
		}
		let proposal = deriveWorkspaceProposal(absolutePath, options, readFile);
		id = proposal.id;
		for (const warning of proposal.warnings) say(`!  ${warning.message}`);
		for (const evidence of proposal.evidence) {
			say(`  ${evidence.key}: ${evidence.value}`);
			say(`      ← ${evidence.source}`);
		}
		const useProposal = await operator.ask({
			type: "select",
			question: "Uso esta proposta?",
			options: [
				{ value: "accept", label: "Uso assim" },
				{ value: "adjust", label: "Quero ajustar" },
			],
			default: "accept",
		});
		if (useProposal === "adjust") {
			const adjustedId = await operator.ask({ type: "text", question: "Identificador", default: id });
			const adjustedKind = await operator.ask({
				type: "select",
				question: "Tipo do workspace",
				options: WORKSPACE_KINDS.map((value) => ({ value, label: value })),
				default: String(proposal.entry.kind),
			});
			proposal = deriveWorkspaceProposal(
				absolutePath,
				{ ...options, id: adjustedId, kind: adjustedKind },
				readFile,
			);
			id = proposal.id;
		}

		const configPath = catalogConfigPath(root, catalogEnv);
		const trail =
			deps.trail ??
			createFileOperationTrail(catalogTrailPath(configPath), deps.fs ?? createNodeOperationFileSystem());
		let current: Record<string, unknown> = {};
		try {
			current = JSON.parse(readFile(configPath)) as Record<string, unknown>;
		} catch {
			current = {};
		}
		const alreadyDeclared = declaredWorkspacesFromConfig(current, { baseDir: root }).some(
			(workspace) => workspace?.id === proposal.id,
		);
		const prior = await standingCatalogDecision(trail, WORKSPACE_BLOCK, id);
		if ((alreadyDeclared || prior) && !options.replace) {
			const again = await operator.ask({
				type: "confirm",
				question: alreadyDeclared
					? `Já existe um workspace chamado "${id}". Substituir?`
					: `Você já decidiu sobre "${id}". Decidir novamente?`,
				default: false,
			});
			if (!again) {
				return {
					status: "unchanged",
					workspace: id,
					reason: alreadyDeclared ? "already-declared" : "already-decided",
				};
			}
		}

		const plan = planCatalogDeclaration({
			block: WORKSPACE_BLOCK,
			name: id,
			entry: proposal.entry,
			root,
			env: catalogEnv,
			// ISS-036. `buildWorkspaceDeclaration` produces exactly these four keys, so on a
			// `--replace` everything else the operator declared — a `commands` allowlist, an
			// `issues` provider, a `cache` block — is none of this writer's business and survives.
			// On the operator's real node the dropped block was rcdc5's `vpn` and
			// `code-boundaries`, which `workspace sync` cannot restore.
			ownedKeys: ["path", "kind", "execution", "repository"],
		});
		const proposedConfig = JSON.parse(plan.after) as Record<string, unknown>;
		if (
			!declaredWorkspacesFromConfig(proposedConfig, { baseDir: root }).some(
				(workspace) => workspace?.id === id,
			)
		) {
			throw new WorkspaceAddRefusal(
				"workspace-add-invalid-declaration",
				`The proposed declaration for ${JSON.stringify(id)} does not satisfy the workspace contract.`,
			);
		}
		const request = buildCatalogOperationRequest({
			plan,
			title: `${WORKSPACE_ADD_COMMAND} ${absolutePath}`,
			purpose: `Declarar "${id}" como workspace que este host pode observar e operar por comandos nomeados.`,
			requester: WORKSPACE_ADD_COMMAND,
			requestedAt: (deps.now ?? (() => new Date().toISOString()))(),
			notes: [
				"O path é autoridade local deste host e é removido de qualquer config node replicável.",
				"Esta declaração pertence ao catálogo do operador e fica disponível fora de checkouts.",
			],
		});
		for (const line of renderCatalogProposal(request)) say(line);
		const outcome = await authorCatalogDeclaration({
			request,
			channel: operator,
			trail,
			...(deps.fs ? { fs: deps.fs } : {}),
			...(deps.now ? { now: deps.now } : {}),
			...(deps.decidedBy ? { decidedBy: deps.decidedBy } : {}),
			host: deps.host ?? os.hostname(),
			...(prior || alreadyDeclared ? { revisit: true } : {}),
		});
		if (outcome.status === "declined") {
			return { status: "declined", workspace: id, recordId: outcome.record.id };
		}
		// `already-asked` is NOT `deferred`. Deferred is the operator saying "not now"; this is
		// somebody ELSE still waiting on the same question — usually a run that asked and died,
		// whose card is still standing. Collapsing them would tell the operator they declined
		// something they were never shown.
		if (outcome.status === "already-asked") {
			return { status: "already-asked", workspace: id, question: outcome.question };
		}
		if (outcome.status !== "authorized") return { status: "deferred", workspace: id };
		return {
			status: "declared",
			workspace: id,
			entry: proposal.entry,
			configPath: plan.configPath,
			recordId: outcome.record.id,
			undoCommand: refarmCommand(["config", "history", "undo", outcome.record.id]),
			replaced: plan.replaced,
		};
	} catch (error) {
		if (error instanceof OperatorPromptCancelledError) return { status: "cancelled", workspace: id };
		throw error;
	}
}
