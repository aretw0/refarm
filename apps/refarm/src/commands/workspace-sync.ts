/**
 * `refarm workspace sync <id>` — the offer becomes a proposal, never a merge.
 *
 * Design: `docs/superpowers/specs/2026-08-06-a-workspace-is-not-a-node-design.md`.
 * "adiantar não é autorizar" — preparing is not authorising. A workspace's own
 * declaration (`workspace.json`, Task 1's `parseWorkspaceOffer`) arrives by `git
 * pull`. It becomes visible to a node that administers it and does NOT become live
 * on its own — that would let a repository update silently change what this
 * machine executes. This module is the review surface in between: it reads the
 * offer, computes what would change against the node's OWN catalog, and writes
 * only when the operator says yes through the same reviewed-consent journey
 * `workspace add`/`workspace command add` already use.
 *
 * R3 (the design's third rule) is the case that matters: on a name collision the
 * node's definition is KEPT and the workspace's rejected one is SURFACED, not
 * dropped. `planWorkspaceSync` below is pure precisely so that guarantee is
 * something a test can assert on literals, not something that only shows up when
 * a real file happens to collide.
 */
import { declaredBase, declaredWorkspaceFromConfig, loadConfig, type DeclaredWorkspaceConfig } from "@refarm.dev/config";
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
import { refarmCommand } from "../brand.js";
import {
	authorCatalogDeclaration,
	buildCatalogOperationRequest,
	catalogConfigPath,
	catalogTrailPath,
	planCatalogDeclaration,
	renderCatalogProposal,
} from "./catalog-authoring.js";
import { parseWorkspaceOffer, workspaceOfferPath, type WorkspaceOffer } from "./workspace-declaration.js";
import type { WorkspaceDeclaredCommand } from "./workspace.js";

const WORKSPACE_SYNC_COMMAND = refarmCommand(["workspace", "sync"]);
const WORKSPACE_ADD_COMMAND = refarmCommand(["workspace", "add"]);

/** The value recorded on an accepted command — see `WorkspaceDeclaredCommand.source`
 *  (`./workspace.ts`) and the mirrored, fail-closed acceptance in
 *  `normalizeWorkspaceCommands` (`@refarm.dev/config`). */
const WORKSPACE_OFFER_SOURCE = "workspace-offer" as const;

export class WorkspaceSyncRefusal extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "WorkspaceSyncRefusal";
	}
}

export interface WorkspaceSyncAddition {
	name: string;
	command: WorkspaceDeclaredCommand;
}

/** A name collision — the node's definition survives (`kept`), and the
 *  workspace's is SURFACED rather than silently dropped (`rejected`). Reading
 *  only `kept` off a plan is exactly the failure shape this exists to prevent:
 *  a plan that merely dropped the workspace's version would look identical from
 *  that one field. */
export interface WorkspaceSyncCollision {
	name: string;
	kept: WorkspaceDeclaredCommand;
	rejected: WorkspaceDeclaredCommand;
}

export interface WorkspaceSyncUnchanged {
	name: string;
	command: WorkspaceDeclaredCommand;
}

export interface WorkspaceSyncPlan {
	additions: WorkspaceSyncAddition[];
	collisions: WorkspaceSyncCollision[];
	unchanged: WorkspaceSyncUnchanged[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Compares only the fields an OFFER can ever carry (`run`, `cwd`, `description`,
 *  `remote`, `result`) — deliberately blind to catalog-only provenance
 *  (`WorkspaceDeclaredCommand.source`), which the offer never has an opinion on.
 *  A previously-accepted command re-offered unchanged must read as unchanged, not
 *  as a collision against its own history. */
function commandsMatch(a: WorkspaceDeclaredCommand, b: WorkspaceDeclaredCommand): boolean {
	if (a.run.length !== b.run.length || a.run.some((token, index) => token !== b.run[index])) return false;
	if ((a.cwd ?? null) !== (b.cwd ?? null)) return false;
	if ((a.description ?? null) !== (b.description ?? null)) return false;
	if ((a.remote ?? false) !== (b.remote ?? false)) return false;
	if ((a.result ?? null) !== (b.result ?? null)) return false;
	return true;
}

/**
 * PURE. Compares a workspace's offer against the node's OWN catalog entry for
 * that workspace and reports, per offered command name: an addition (the
 * catalog has nothing by that name), a collision (the catalog already has a
 * DIFFERENT definition — the node's is `kept`, the workspace's is `rejected`),
 * or unchanged (the catalog already has the identical definition). Commands the
 * catalog declares that the offer never mentions are outside this plan entirely
 * — they are the node's own, and `sync` has no opinion on them.
 */
export function planWorkspaceSync(input: {
	offer: WorkspaceOffer;
	catalogEntry: DeclaredWorkspaceConfig;
}): WorkspaceSyncPlan {
	const catalogCommands =
		((input.catalogEntry as { commands?: Record<string, WorkspaceDeclaredCommand> } | null)
			?.commands as Record<string, WorkspaceDeclaredCommand> | undefined) ?? {};
	const offeredNames = Object.keys(input.offer.commands ?? {}).sort();

	const additions: WorkspaceSyncAddition[] = [];
	const collisions: WorkspaceSyncCollision[] = [];
	const unchanged: WorkspaceSyncUnchanged[] = [];

	for (const name of offeredNames) {
		const offered = input.offer.commands[name];
		if (!offered) continue;
		const existing = catalogCommands[name];
		if (!existing) {
			additions.push({ name, command: offered });
			continue;
		}
		if (commandsMatch(existing, offered)) {
			unchanged.push({ name, command: existing });
			continue;
		}
		collisions.push({ name, kept: existing, rejected: offered });
	}

	return { additions, collisions, unchanged };
}

/** Human-readable lines for a plan — used for BOTH the interactive announce
 *  stream and (indirectly) what `--json` mode reports as structured data. Pure
 *  formatting, no I/O. */
export function formatWorkspaceSyncPlanLines(workspace: string, plan: WorkspaceSyncPlan, offerPath: string): string[] {
	const lines: string[] = [`Workspace sync: ${workspace}`, `  offer: ${offerPath}`];
	if (plan.additions.length === 0 && plan.collisions.length === 0 && plan.unchanged.length === 0) {
		lines.push("  the workspace offers nothing");
		return lines;
	}
	if (plan.additions.length > 0) {
		lines.push(`  additions (${plan.additions.length}):`);
		for (const addition of plan.additions) {
			lines.push(`    + ${addition.name}: ${addition.command.run.join(" ")}`);
		}
	}
	if (plan.collisions.length > 0) {
		lines.push(`  collisions (${plan.collisions.length}) — this node's definition is kept, the offer's is rejected:`);
		for (const collision of plan.collisions) {
			lines.push(`    ! ${collision.name}`);
			lines.push(`      kept:     ${collision.kept.run.join(" ")}`);
			lines.push(`      rejected: ${collision.rejected.run.join(" ")}`);
		}
	}
	if (plan.unchanged.length > 0) {
		lines.push(`  unchanged (${plan.unchanged.length}): ${plan.unchanged.map((entry) => entry.name).join(", ")}`);
	}
	return lines;
}

export interface WorkspaceSyncOptions {
	workspace: string;
	json?: boolean;
	attendedElsewhere?: boolean;
}

export interface WorkspaceSyncDeps {
	/** Node catalog root — same resolution `workspace list`/`workspace status` use
	 *  (`declaredBase()`), so `sync <id>` resolves exactly the workspace `list`
	 *  showed. Injected directly in tests, bypassing env/cwd resolution. */
	root?: string;
	env?: NodeJS.ProcessEnv;
	loadConfig?: (root?: string) => unknown;
	interactive?: boolean;
	operator?: OperatorChannel;
	trail?: OperationTrail;
	fs?: OperationFileSystem;
	now?: () => string;
	decidedBy?: string;
	host?: string;
	exists?: (candidate: string) => boolean;
	readFile?: (candidate: string) => string;
	announce?: (line: string) => void;
}

interface WorkspaceSyncResultBase {
	workspace: string;
	plan: WorkspaceSyncPlan;
	configPath: string;
	offerPath: string;
}

export type WorkspaceSyncResult =
	| (WorkspaceSyncResultBase & { status: "inspected" })
	| (WorkspaceSyncResultBase & { status: "nothing-to-sync" })
	| (WorkspaceSyncResultBase & { status: "declared"; recordId: string; undoCommand: string })
	| (WorkspaceSyncResultBase & { status: "declined" | "deferred"; recordId?: string })
	| (WorkspaceSyncResultBase & { status: "cancelled" });

/**
 * Resolve `<id>` from the node catalog, read its offer, compute the plan, and —
 * only when NOT `--json` and there is at least one addition — ask the operator
 * to authorise writing those additions into the catalog. `--json` returns
 * `status: "inspected"` before touching the operator channel, the trail, or the
 * filesystem write path at all: inspection can never write, by construction, not
 * merely by convention.
 */
export async function runWorkspaceSync(
	options: WorkspaceSyncOptions,
	deps: WorkspaceSyncDeps = {},
): Promise<WorkspaceSyncResult> {
	const env = deps.env ?? process.env;
	const root = deps.root ?? declaredBase(env);
	const exists = deps.exists ?? fs.existsSync;
	const readFile = deps.readFile ?? ((candidate: string) => fs.readFileSync(candidate, "utf8"));

	const config = (deps.loadConfig ?? loadConfig)(root);
	const catalogEntry = declaredWorkspaceFromConfig(config, options.workspace, {
		baseDir: root,
	}) as DeclaredWorkspaceConfig | null;
	if (!catalogEntry) {
		throw new WorkspaceSyncRefusal(
			"workspace-sync-not-declared",
			`Workspace ${JSON.stringify(options.workspace)} is not declared in the node catalog. Run ${WORKSPACE_ADD_COMMAND} first.`,
		);
	}

	const offerPath = workspaceOfferPath((catalogEntry as { absolutePath: string }).absolutePath);
	let offer: WorkspaceOffer = { commands: {} };
	if (exists(offerPath)) {
		let raw: unknown;
		try {
			raw = JSON.parse(readFile(offerPath));
		} catch {
			throw new WorkspaceSyncRefusal(
				"workspace-sync-offer-unreadable",
				`${offerPath} exists but is not valid JSON — fix it by hand, then run this again.`,
			);
		}
		const parsed = parseWorkspaceOffer(raw);
		if ("error" in parsed) {
			throw new WorkspaceSyncRefusal("workspace-sync-offer-invalid", parsed.error);
		}
		offer = parsed.offer;
	}

	const plan = planWorkspaceSync({ offer, catalogEntry });
	const configPath = catalogConfigPath(root, env);
	const workspaceId = (catalogEntry as { id: string }).id;

	if (options.json) {
		return { status: "inspected", workspace: workspaceId, plan, configPath, offerPath };
	}

	const say = deps.announce ?? ((line: string) => console.log(line));
	for (const line of formatWorkspaceSyncPlanLines(workspaceId, plan, offerPath)) say(line);

	if (plan.additions.length === 0) {
		return { status: "nothing-to-sync", workspace: workspaceId, plan, configPath, offerPath };
	}

	const interactive =
		deps.interactive ?? Boolean((process.stdin.isTTY && process.stdout.isTTY) || options.attendedElsewhere);
	if (!interactive) {
		throw new WorkspaceSyncRefusal(
			"workspace-sync-not-interactive",
			`Accepting a workspace's offer is your authorisation, and there is nowhere to ask you. Run ${WORKSPACE_SYNC_COMMAND} from an interactive surface.`,
		);
	}

	let rawConfig: Record<string, unknown>;
	try {
		rawConfig = JSON.parse(readFile(configPath)) as Record<string, unknown>;
	} catch {
		throw new WorkspaceSyncRefusal("workspace-sync-config-unreadable", `Cannot read ${configPath}.`);
	}
	const workspacesBlock = isRecord(rawConfig.workspaces) ? rawConfig.workspaces : {};
	const existingRaw = workspacesBlock[workspaceId];
	if (!isRecord(existingRaw)) {
		throw new WorkspaceSyncRefusal(
			"workspace-sync-not-declared",
			`Workspace ${JSON.stringify(workspaceId)} is not declared in ${configPath}.`,
		);
	}
	const existingCommands = isRecord(existingRaw.commands) ? existingRaw.commands : {};
	const acceptedCommands: Record<string, unknown> = {};
	for (const addition of plan.additions) {
		acceptedCommands[addition.name] = { ...addition.command, source: WORKSPACE_OFFER_SOURCE };
	}
	const entry = { ...existingRaw, commands: { ...existingCommands, ...acceptedCommands } };

	const operationId = `accept:workspace-sync:${workspaceId}`;
	const trail =
		deps.trail ?? createFileOperationTrail(catalogTrailPath(configPath), deps.fs ?? createNodeOperationFileSystem());
	const prior = standingDecision(await trail.read(), operationId);
	const catalogPlan = planCatalogDeclaration({ block: "workspaces", name: workspaceId, entry, root, env });
	const request = buildCatalogOperationRequest({
		plan: catalogPlan,
		operationId,
		operationKind: "accept-workspace-sync",
		title: `${WORKSPACE_SYNC_COMMAND} ${workspaceId}`,
		purpose: `Aceitar ${plan.additions.length} comando(s) que "${workspaceId}" ofereceu em ${offerPath}.`,
		requester: WORKSPACE_SYNC_COMMAND,
		requestedAt: (deps.now ?? (() => new Date().toISOString()))(),
		notes: [
			`A oferta veio de ${offerPath}; aceitar muda o que este nó executa, não o que o workspace declarou.`,
			plan.collisions.length > 0
				? `${plan.collisions.length} comando(s) da oferta colidem com nomes já declarados aqui e continuam como estavam — nada é sobrescrito silenciosamente.`
				: "Nenhuma colisão de nomes com o que este nó já declara.",
		],
	});
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
			return { status: "declined", workspace: workspaceId, plan, configPath, offerPath, recordId: outcome.record.id };
		}
		if (outcome.status !== "authorized") {
			return { status: "deferred", workspace: workspaceId, plan, configPath, offerPath };
		}
		return {
			status: "declared",
			workspace: workspaceId,
			plan,
			configPath,
			offerPath,
			recordId: outcome.record.id,
			undoCommand: refarmCommand(["config", "history", "undo", outcome.record.id]),
		};
	} catch (error) {
		if (error instanceof OperatorPromptCancelledError) {
			return { status: "cancelled", workspace: workspaceId, plan, configPath, offerPath };
		}
		throw error;
	}
}
