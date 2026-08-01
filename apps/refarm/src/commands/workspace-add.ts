import { declaredWorkspacesFromConfig, WORKSPACE_KINDS } from "@refarm.dev/config";
import {
	createFileOperationTrail,
	createNodeOperationFileSystem,
	type OperationFileSystem,
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
	| { status: "unchanged"; workspace: string; reason: "already-declared" | "already-decided" };

export class WorkspaceAddRefusal extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = "WorkspaceAddRefusal";
	}
}

function workspaceId(value: string): string {
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

function repositoryUrl(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	try {
		const parsed = new URL(trimmed);
		if (parsed.username || parsed.password) {
			throw new WorkspaceAddRefusal(
				"workspace-add-repository-contains-credential",
				"The repository URL contains credentials. Use a credential-free URL; secrets never enter config or its operation trail.",
			);
		}
	} catch (error) {
		if (error instanceof WorkspaceAddRefusal) throw error;
		// SCP-style Git URLs (git@host:owner/repo.git) are intentionally valid.
	}
	return trimmed;
}

export function deriveWorkspaceProposal(
	workspacePath: string,
	options: Pick<WorkspaceAddOptions, "id" | "kind" | "repository">,
	readFile: (candidate: string) => string = (candidate) => fs.readFileSync(candidate, "utf8"),
): { id: string; entry: Record<string, unknown>; evidence: string[] } {
	const packageJson = readJson(path.join(workspacePath, "package.json"), readFile);
	const packageName = typeof packageJson.name === "string" ? packageJson.name : "";
	const id = workspaceId(options.id || packageName.replace(/^@[^/]+\//, "") || path.basename(workspacePath));
	if (!id) throw new WorkspaceAddRefusal("workspace-add-invalid-id", "Workspace id must not be blank.");
	const inferredKind = packageName === "refarm" ? "refarm" : "project";
	const kind = options.kind ?? inferredKind;
	if (!WORKSPACE_KINDS.includes(kind)) {
		throw new WorkspaceAddRefusal(
			"workspace-add-invalid-kind",
			`Unknown workspace kind ${JSON.stringify(kind)}; use ${WORKSPACE_KINDS.join(", ")}.`,
		);
	}
	const repository = repositoryUrl(options.repository || originUrl(workspacePath, readFile));
	return {
		id,
		entry: {
			path: workspacePath,
			kind,
			execution: { preferredAdapter: "auto" },
			...(repository ? { repository: { url: repository } } : {}),
		},
		evidence: [
			`path: ${workspacePath} (caminho resolvido neste host; não replica)`,
			`id: ${id} (${packageName ? "package.json#name" : "nome do diretório"})`,
			`kind: ${kind} (${options.kind ? "--kind" : packageName === "refarm" ? "package.json" : "padrão project"})`,
			...(repository ? [`repository: ${repository} (${options.repository ? "--repository" : ".git/config origin"})`] : []),
		],
	};
}

export async function runWorkspaceAdd(
	options: WorkspaceAddOptions,
	deps: WorkspaceAddDeps = {},
): Promise<WorkspaceAddResult> {
	const env = deps.env ?? process.env;
	const cwd = deps.cwd ?? process.cwd();
	const operatorHome = path.resolve(resolveRefarmHome(env));
	const root = deps.root ?? (options.local ? cwd : path.dirname(operatorHome));
	const catalogEnv =
		deps.root || options.local
			? env
			: { ...env, SOVEREIGN_DIR: path.basename(operatorHome) };
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
		for (const line of proposal.evidence) say(`  ${line}`);
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
				options.local
					? "Esta declaração pertence somente ao workspace atual (--local)."
					: "Esta declaração pertence ao catálogo do operador e fica disponível fora de checkouts.",
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
		if (outcome.status !== "authorized") return { status: "deferred", workspace: id };
		return {
			status: "declared",
			workspace: id,
			entry: proposal.entry,
			configPath: plan.configPath,
			recordId: outcome.record.id,
			undoCommand: refarmCommand([
				"config",
				"history",
				"undo",
				outcome.record.id,
				...(options.local ? ["--local"] : []),
			]),
			replaced: plan.replaced,
		};
	} catch (error) {
		if (error instanceof OperatorPromptCancelledError) return { status: "cancelled", workspace: id };
		throw error;
	}
}
