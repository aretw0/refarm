import {
	deriveWorkspaceCommandDeclaration,
	WorkspaceCommandDeclarationError,
} from "@refarm.dev/cli/workspace-command-declaration";
import {
	createFileOperationTrail,
	createNodeOperationFileSystem,
	standingDecision,
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
} from "./catalog-authoring.js";

const COMMAND = refarmCommand(["workspace", "command", "add"]);
const REMOTE_COMMAND = refarmCommand(["workspace", "command", "remote"]);

export interface WorkspaceCommandAddOptions {
	workspace: string;
	name: string;
	argv: string[];
	cwd?: string;
	description?: string;
	remote?: boolean;
	result?: string;
	replace?: boolean;
	local?: boolean;
	attendedElsewhere?: boolean;
}

export interface WorkspaceCommandAddDeps {
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
	announce?: (line: string) => void;
}

export type WorkspaceCommandAddResult =
	| { status: "declared"; workspace: string; command: string; configPath: string; recordId: string; undoCommand: string }
	| { status: "declined" | "deferred"; workspace: string; command: string }
	| { status: "cancelled"; workspace: string; command: string };

export type WorkspaceCommandRemoveResult = WorkspaceCommandAddResult;

export interface WorkspaceCommandRemoteOptions {
	workspace: string;
	name: string;
	remote: boolean;
	local?: boolean;
	attendedElsewhere?: boolean;
}

export class WorkspaceCommandAddRefusal extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = "WorkspaceCommandAddRefusal";
	}
}

/** Expose or recollect an existing operation without asking the operator to restate its argv. */
export async function runWorkspaceCommandRemote(
	options: WorkspaceCommandRemoteOptions,
	deps: WorkspaceCommandAddDeps = {},
): Promise<WorkspaceCommandAddResult> {
	const env = deps.env ?? process.env;
	const cwd = deps.cwd ?? process.cwd();
	const operatorHome = path.resolve(resolveRefarmHome(env));
	const root = deps.root ?? (options.local ? cwd : path.dirname(operatorHome));
	const catalogEnv =
		deps.root || options.local ? env : { ...env, SOVEREIGN_DIR: path.basename(operatorHome) };
	const configPath = catalogConfigPath(root, catalogEnv);
	let config: Record<string, unknown>;
	try {
		config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
	} catch {
		throw new WorkspaceCommandAddRefusal(
			"workspace-command-config-unreadable",
			`Cannot read ${configPath}.`,
		);
	}
	const workspaces = isRecord(config.workspaces) ? config.workspaces : {};
	const existingWorkspace = workspaces[options.workspace];
	if (!isRecord(existingWorkspace)) {
		throw new WorkspaceCommandAddRefusal(
			"workspace-command-workspace-not-declared",
			`Workspace ${JSON.stringify(options.workspace)} is not declared.`,
		);
	}
	const existingCommands = isRecord(existingWorkspace.commands) ? existingWorkspace.commands : {};
	const existingCommand = existingCommands[options.name];
	if (!isRecord(existingCommand)) {
		throw new WorkspaceCommandAddRefusal(
			"workspace-command-not-declared",
			`Operation ${JSON.stringify(options.name)} is not declared for workspace ${JSON.stringify(options.workspace)}.`,
		);
	}
	const isRemote = existingCommand.remote === true;
	if (isRemote === options.remote) {
		throw new WorkspaceCommandAddRefusal(
			"workspace-command-remote-unchanged",
			`Operation ${JSON.stringify(options.name)} is already ${options.remote ? "remote" : "local-only"}.`,
		);
	}
	const interactive =
		deps.interactive ??
		Boolean((process.stdin.isTTY && process.stdout.isTTY) || options.attendedElsewhere);
	if (!interactive) {
		throw new WorkspaceCommandAddRefusal(
			"workspace-command-not-interactive",
			"Changing remote admission requires an attended consent surface.",
		);
	}
	const { remote: _remote, ...commandWithoutRemote } = existingCommand;
	const updatedCommand = options.remote
		? { ...commandWithoutRemote, remote: true }
		: commandWithoutRemote;
	const entry = {
		...existingWorkspace,
		commands: { ...existingCommands, [options.name]: updatedCommand },
	};
	const mode = options.remote ? "enable" : "disable";
	const operationId = `declare:workspace-command-remote:${mode}:${options.workspace}:${options.name}`;
	const trail =
		deps.trail ??
		createFileOperationTrail(
			catalogTrailPath(configPath),
			deps.fs ?? createNodeOperationFileSystem(),
		);
	const prior = standingDecision(await trail.read(), operationId);
	const plan = planCatalogDeclaration({
		block: "workspaces",
		name: options.workspace,
		entry,
		root,
		env: catalogEnv,
	});
	const request = buildCatalogOperationRequest({
		plan,
		operationId,
		operationKind: "declare-workspace-command-remote",
		title: `${REMOTE_COMMAND} ${mode} ${options.workspace} ${options.name}`,
		purpose: options.remote
			? `Permitir que aparelhos enrolados iniciem "${options.workspace}:${options.name}".`
			: `Recolher "${options.workspace}:${options.name}" para uso somente local.`,
		requester: REMOTE_COMMAND,
		requestedAt: (deps.now ?? (() => new Date().toISOString()))(),
		notes: [
			"run, cwd e description são preservados byte a byte; somente a admissão remota muda.",
			"O aparelho envia um id opaco; nunca envia argv ou argumentos extras.",
		],
	});
	const say = deps.announce ?? ((line: string) => console.log(line));
	for (const line of renderCatalogProposal(request)) say(line);
	try {
		const outcome = await authorCatalogDeclaration({
			request,
			channel: deps.operator ?? createStdioOperatorChannel(),
			trail,
			...(deps.fs ? { fs: deps.fs } : {}),
			...(deps.now ? { now: deps.now } : {}),
			...(deps.decidedBy ? { decidedBy: deps.decidedBy } : {}),
			host: deps.host ?? os.hostname(),
			...(prior ? { revisit: true } : {}),
		});
		if (outcome.status === "declined") {
			return { status: "declined", workspace: options.workspace, command: options.name };
		}
		if (outcome.status !== "authorized") {
			return { status: "deferred", workspace: options.workspace, command: options.name };
		}
		return {
			status: "declared",
			workspace: options.workspace,
			command: options.name,
			configPath,
			recordId: outcome.record.id,
			undoCommand: refarmCommand([
				"config",
				"history",
				"undo",
				outcome.record.id,
				...(options.local ? ["--local"] : []),
			]),
		};
	} catch (error) {
		if (error instanceof OperatorPromptCancelledError) {
			return { status: "cancelled", workspace: options.workspace, command: options.name };
		}
		throw error;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function runWorkspaceCommandAdd(
	options: WorkspaceCommandAddOptions,
	deps: WorkspaceCommandAddDeps = {},
): Promise<WorkspaceCommandAddResult> {
	const env = deps.env ?? process.env;
	const cwd = deps.cwd ?? process.cwd();
	const operatorHome = path.resolve(resolveRefarmHome(env));
	const root = deps.root ?? (options.local ? cwd : path.dirname(operatorHome));
	const catalogEnv = deps.root || options.local ? env : { ...env, SOVEREIGN_DIR: path.basename(operatorHome) };
	const configPath = catalogConfigPath(root, catalogEnv);
	let config: Record<string, unknown>;
	try {
		config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
	} catch {
		throw new WorkspaceCommandAddRefusal("workspace-command-config-unreadable", `Cannot read ${configPath}.`);
	}
	const workspaces = isRecord(config.workspaces) ? config.workspaces : {};
	const existingWorkspace = workspaces[options.workspace];
	if (!isRecord(existingWorkspace)) {
		throw new WorkspaceCommandAddRefusal(
			"workspace-command-workspace-not-declared",
			`Workspace ${JSON.stringify(options.workspace)} is not declared. Run ${refarmCommand(["workspace", "add"])} first.`,
		);
	}
	let proposal;
	try {
		proposal = deriveWorkspaceCommandDeclaration(options);
	} catch (error) {
		if (error instanceof WorkspaceCommandDeclarationError) {
			throw new WorkspaceCommandAddRefusal(error.code, error.message);
		}
		throw error;
	}
	const interactive = deps.interactive ?? Boolean((process.stdin.isTTY && process.stdout.isTTY) || options.attendedElsewhere);
	if (!interactive) {
		throw new WorkspaceCommandAddRefusal(
			"workspace-command-not-interactive",
			`Declaring an operation requires an attended consent surface. Run ${COMMAND} interactively.`,
		);
	}
	const existingCommands = isRecord(existingWorkspace.commands) ? existingWorkspace.commands : {};
	const alreadyDeclared = proposal.name in existingCommands;
	const entry = {
		...existingWorkspace,
		commands: { ...existingCommands, [proposal.name]: proposal.entry },
	};
	const operationId = `declare:workspace-command:${options.workspace}:${proposal.name}`;
	const trail = deps.trail ?? createFileOperationTrail(catalogTrailPath(configPath), deps.fs ?? createNodeOperationFileSystem());
	const prior = standingDecision(await trail.read(), operationId);
	if ((alreadyDeclared || prior) && !options.replace) {
		throw new WorkspaceCommandAddRefusal(
			"workspace-command-already-declared",
			`Operation ${JSON.stringify(proposal.name)} already exists or was decided. Re-run with --replace to review it again.`,
		);
	}
	const plan = planCatalogDeclaration({ block: "workspaces", name: options.workspace, entry, root, env: catalogEnv });
	const request = buildCatalogOperationRequest({
		plan,
		operationId,
		operationKind: "declare-workspace-command",
		title: `${COMMAND} ${options.workspace} ${proposal.name}`,
		purpose: `Autorizar a operação nomeada "${proposal.name}" no workspace "${options.workspace}".`,
		requester: COMMAND,
		requestedAt: (deps.now ?? (() => new Date().toISOString()))(),
		notes: [
			"O comando é argv exato, executado sem shell; argumentos extras só entram quando uma superfície os fornece explicitamente.",
			proposal.entry.remote === true
				? "A operação será visível a aparelhos enrolados; o aparelho envia somente seu nome, nunca argv."
				: "A operação permanece local; silêncio não abre acesso remoto.",
			"Esta mudança preserva o restante da declaração do workspace.",
		],
	});
	const say = deps.announce ?? ((line: string) => console.log(line));
	for (const line of renderCatalogProposal(request)) say(line);
	try {
		const outcome = await authorCatalogDeclaration({
			request,
			channel: deps.operator ?? createStdioOperatorChannel(),
			trail,
			...(deps.fs ? { fs: deps.fs } : {}),
			...(deps.now ? { now: deps.now } : {}),
			...(deps.decidedBy ? { decidedBy: deps.decidedBy } : {}),
			host: deps.host ?? os.hostname(),
			...(alreadyDeclared || prior ? { revisit: true } : {}),
		});
		if (outcome.status === "declined") return { status: "declined", workspace: options.workspace, command: proposal.name };
		if (outcome.status !== "authorized") return { status: "deferred", workspace: options.workspace, command: proposal.name };
		return {
			status: "declared",
			workspace: options.workspace,
			command: proposal.name,
			configPath,
			recordId: outcome.record.id,
			undoCommand: refarmCommand(["config", "history", "undo", outcome.record.id, ...(options.local ? ["--local"] : [])]),
		};
	} catch (error) {
		if (error instanceof OperatorPromptCancelledError) {
			return { status: "cancelled", workspace: options.workspace, command: proposal.name };
		}
		throw error;
	}
}

/** Remove one named operation through the same reviewed trail used to add it. */
export async function runWorkspaceCommandRemove(
	options: Pick<WorkspaceCommandAddOptions, "workspace" | "name" | "local" | "attendedElsewhere">,
	deps: WorkspaceCommandAddDeps = {},
): Promise<WorkspaceCommandRemoveResult> {
	const env = deps.env ?? process.env;
	const cwd = deps.cwd ?? process.cwd();
	const operatorHome = path.resolve(resolveRefarmHome(env));
	const root = deps.root ?? (options.local ? cwd : path.dirname(operatorHome));
	const catalogEnv = deps.root || options.local ? env : { ...env, SOVEREIGN_DIR: path.basename(operatorHome) };
	const configPath = catalogConfigPath(root, catalogEnv);
	let config: Record<string, unknown>;
	try {
		config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
	} catch {
		throw new WorkspaceCommandAddRefusal("workspace-command-config-unreadable", `Cannot read ${configPath}.`);
	}
	const workspaces = isRecord(config.workspaces) ? config.workspaces : {};
	const existingWorkspace = workspaces[options.workspace];
	if (!isRecord(existingWorkspace)) {
		throw new WorkspaceCommandAddRefusal(
			"workspace-command-workspace-not-declared",
			`Workspace ${JSON.stringify(options.workspace)} is not declared.`,
		);
	}
	const existingCommands = isRecord(existingWorkspace.commands) ? existingWorkspace.commands : {};
	if (!(options.name in existingCommands)) {
		throw new WorkspaceCommandAddRefusal(
			"workspace-command-not-declared",
			`Operation ${JSON.stringify(options.name)} is not declared for workspace ${JSON.stringify(options.workspace)}.`,
		);
	}
	const interactive = deps.interactive ?? Boolean((process.stdin.isTTY && process.stdout.isTTY) || options.attendedElsewhere);
	if (!interactive) {
		throw new WorkspaceCommandAddRefusal(
			"workspace-command-not-interactive",
			"Removing an operation requires an attended consent surface.",
		);
	}
	const commands = { ...existingCommands };
	delete commands[options.name];
	const entry = {
		...existingWorkspace,
		...(Object.keys(commands).length > 0 ? { commands } : {}),
	};
	if (Object.keys(commands).length === 0) delete entry.commands;
	const operationId = `remove:workspace-command:${options.workspace}:${options.name}`;
	const trail = deps.trail ?? createFileOperationTrail(catalogTrailPath(configPath), deps.fs ?? createNodeOperationFileSystem());
	const prior = standingDecision(await trail.read(), operationId);
	const plan = planCatalogDeclaration({ block: "workspaces", name: options.workspace, entry, root, env: catalogEnv });
	const request = buildCatalogOperationRequest({
		plan,
		operationId,
		operationKind: "remove-workspace-command",
		title: `${refarmCommand(["workspace", "command", "remove"])} ${options.workspace} ${options.name}`,
		purpose: `Remover a operação nomeada "${options.name}" do workspace "${options.workspace}".`,
		requester: refarmCommand(["workspace", "command", "remove"]),
		requestedAt: (deps.now ?? (() => new Date().toISOString()))(),
		notes: ["O workspace e todas as suas outras declarações permanecem intactos."],
	});
	const say = deps.announce ?? ((line: string) => console.log(line));
	for (const line of renderCatalogProposal(request)) say(line);
	try {
		const outcome = await authorCatalogDeclaration({
			request,
			channel: deps.operator ?? createStdioOperatorChannel(),
			trail,
			...(deps.fs ? { fs: deps.fs } : {}),
			...(deps.now ? { now: deps.now } : {}),
			...(deps.decidedBy ? { decidedBy: deps.decidedBy } : {}),
			host: deps.host ?? os.hostname(),
			...(prior ? { revisit: true } : {}),
		});
		if (outcome.status === "declined") return { status: "declined", workspace: options.workspace, command: options.name };
		if (outcome.status !== "authorized") return { status: "deferred", workspace: options.workspace, command: options.name };
		return {
			status: "declared",
			workspace: options.workspace,
			command: options.name,
			configPath,
			recordId: outcome.record.id,
			undoCommand: refarmCommand(["config", "history", "undo", outcome.record.id, ...(options.local ? ["--local"] : [])]),
		};
	} catch (error) {
		if (error instanceof OperatorPromptCancelledError) {
			return { status: "cancelled", workspace: options.workspace, command: options.name };
		}
		throw error;
	}
}
