/**
 * `refarm issues` — work items for a DECLARED workspace's ledger, resolved through the
 * operator's catalog (`~/.refarm/config.json`), never through the current directory's own
 * `.project/` folder. `refarm project` resolves `.project/handoff.json` relative to
 * `process.cwd()` and so only works from inside this repo; that defect is the reason this is a
 * separate top-level command rather than a subcommand of `project` — see
 * `packages/cli/src/work-items/resolve.ts` for the resolver this command is a thin shell over.
 *
 * THE ONE DELIBERATE cwd READ. Every subcommand below reads `process.cwd()` exactly once, and
 * ONLY to match it against the declared catalog (`resolveWorkspaceLedger` reports the result as
 * `workspaceFrom: "cwd-match"`) — never as a fallback for where to look for a ledger. It is
 * wrapped in `currentDirectoryForCatalogMatch()`, a named, documented function, rather than
 * inlined at each call site, so every read is visibly the SAME one read with the SAME purpose —
 * not because a bare `const cwd = process.cwd()` would trip `scripts/no-os-resolution.mjs`
 * (measured: it would not — that script's own doc names exactly two shapes it counts, `??
 * resolver()` and `= resolver()`, and a `return process.cwd();` inside a named function matches
 * neither, by construction of its regex). The ratchet's scope is silent OS-defaulting; this read
 * is neither silent (it is reported on every envelope) nor a default (there is no fallback
 * behavior here to silently take) — the wrapper exists for that reason, not to dodge a counter.
 */
import { buildJsonErrorEnvelope, buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import {
	qualifyId,
	rejectUnsupportedFields,
	resolveWorkspaceLedger,
	WORK_ITEM_AXES,
	WORK_ITEM_STATUSES,
	type CapabilityTable,
	type LedgerResolution,
	type LedgerWorkspace,
	type WorkItem,
	type WorkItemAxis,
	type WorkItemStatus,
} from "@refarm.dev/cli";
import { declaredBase, declaredWorkspacesFromConfig, loadConfig } from "@refarm.dev/config";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";

import { refarmCommand } from "../brand.js";

function currentDirectoryForCatalogMatch(): string {
	return process.cwd();
}

/** `declaredWorkspacesFromConfig` is JS-inferred as returning `(… | null)[]` because its
 *  `.filter(Boolean)` does not narrow for TypeScript — filtered here, explicitly, rather than
 *  widening `LedgerWorkspace` to tolerate `null`. */
function defaultLoadWorkspaces(): LedgerWorkspace[] {
	const baseDir = declaredBase();
	return declaredWorkspacesFromConfig(loadConfig(baseDir), { baseDir }).filter(
		(workspace): workspace is NonNullable<typeof workspace> => workspace !== null,
	);
}

/** Every filesystem read/write this command performs, gathered behind one seam so a test can
 *  inject a fake catalog and a fake ledger document without touching the operator's real
 *  `~/.refarm/config.json` or any real `.project/issues.json`. */
export interface IssuesIo {
	loadWorkspaces: () => LedgerWorkspace[];
	fileExists: (candidate: string) => boolean;
	readDocument: (candidate: string) => string;
	writeDocument: (candidate: string, contents: string) => void;
}

const defaultIo: IssuesIo = {
	loadWorkspaces: defaultLoadWorkspaces,
	fileExists: (candidate: string) => fs.existsSync(candidate),
	readDocument: (candidate: string) => fs.readFileSync(candidate, "utf-8"),
	writeDocument: (candidate: string, contents: string) => fs.writeFileSync(candidate, contents),
};

type LedgerRefusal = Extract<LedgerResolution, { ok: false }>;

/** A refusal is an envelope, never a throw — the shape every subcommand below shares for a
 *  resolution failure (the workspace itself could not be resolved). */
function refuse(operation: string, resolution: LedgerRefusal, json?: boolean): void {
	const message =
		{
			no_such_workspace: `No declared workspace with that id. Declared: ${resolution.declared.join(", ")}`,
			cwd_unmatched: `This directory is inside no declared workspace. Declared: ${resolution.declared.join(", ")}. Pass --workspace <id>.`,
			no_provider: "This workspace declares no work-item provider and has no .project/issues.json.",
		}[resolution.reason] ?? resolution.reason;
	if (json) {
		const nextAction = refarmCommand(["workspace", "list", "--json"]);
		printJson(
			buildJsonErrorEnvelope({
				command: "issues",
				operation,
				error: resolution.reason,
				message,
				nextAction,
				nextCommand: nextAction,
				nextCommands: [nextAction],
			}),
		);
	} else {
		console.error(chalk.red(message));
	}
	process.exitCode = 1;
}

/** A refusal reached AFTER the workspace resolved — input validation, a ledger read failure, or
 *  an adapter write failure. The workspace is already known here, so the handoff points at a
 *  REAL, concrete `issues list` for that same workspace rather than a placeholder. */
function refuseAfterResolution(
	operation: string,
	workspaceId: string,
	reason: string,
	message: string,
	json?: boolean,
): void {
	const nextAction = refarmCommand(["issues", "list", "--workspace", workspaceId, "--json"]);
	if (json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "issues",
				operation,
				error: reason,
				message,
				nextAction,
				nextCommand: nextAction,
				nextCommands: [nextAction],
			}),
		);
	} else {
		console.error(chalk.red(message));
	}
	process.exitCode = 1;
}

interface IssuesListOptions {
	workspace?: string;
	allWorkspaces?: boolean;
	axis?: string;
	status?: string;
	json?: boolean;
}

type LedgerResolutionOk = Extract<LedgerResolution, { ok: true }>;

interface ListedItemGroup {
	provider: string;
	workspaceFrom: LedgerResolutionOk["workspaceFrom"];
	providerFrom: LedgerResolutionOk["providerFrom"];
	count: number;
	unclassified: number;
	extraFields: string[];
	capabilities: CapabilityTable;
	items: Array<WorkItem & { qualifiedId: string }>;
}

/**
 * The pure(ish) core of `issues list` — given options and IO, decides what the command should
 * report, but never prints or sets `process.exitCode` itself (that is the Commander action's
 * job, below). Exported and unit-tested directly (fake IO, no Commander, no console) so the
 * three states this function must never collapse — a clean group, a named `unreadable` entry
 * under `--all-workspaces`, and an outright refusal for a single-workspace failure — are each
 * provable without going through a real process.
 *
 * THREE STATES, NEVER TWO, on a single-workspace read failure: this used to `continue` past a
 * failed `adapter.list()` exactly like the `--all-workspaces` branch does, which meant
 * `refarm issues list --workspace x --json` against a malformed ledger returned `ok: true` with
 * an EMPTY payload and exit 0 — a zero that was not a real zero, silently indistinguishable from
 * a workspace with no open items. `kind: "read-failure"` exists so the caller refuses instead.
 */
export type IssuesListOutcome =
	| { kind: "refusal"; resolution: LedgerRefusal }
	| { kind: "read-failure"; workspaceId: string; reason: string; message: string }
	| { kind: "ok"; groups: Record<string, ListedItemGroup>; unreadable: Record<string, { reason: string }> };

export interface BuildIssuesListInput extends IssuesIo {
	workspace?: string;
	allWorkspaces?: boolean;
	axis?: string;
	status?: string;
	cwd: string;
}

export function buildIssuesList(input: BuildIssuesListInput): IssuesListOutcome {
	const groups: Record<string, ListedItemGroup> = {};
	const unreadable: Record<string, { reason: string }> = {};
	const targets = input.allWorkspaces ? input.loadWorkspaces().map((workspace) => workspace.id) : [input.workspace];

	for (const target of targets) {
		const resolution = resolveWorkspaceLedger({
			workspace: target,
			cwd: input.cwd,
			enumerated: input.allWorkspaces,
			loadWorkspaces: input.loadWorkspaces,
			fileExists: input.fileExists,
			readDocument: input.readDocument,
			writeDocument: input.writeDocument,
		});
		if (!resolution.ok) {
			if (!input.allWorkspaces) return { kind: "refusal", resolution };
			unreadable[target ?? "(unresolved)"] = { reason: resolution.reason };
			continue;
		}
		const read = resolution.adapter.list();
		if (!read.ok) {
			const reason = read.error?.reason ?? "document_unreadable";
			if (!input.allWorkspaces) {
				return {
					kind: "read-failure",
					workspaceId: resolution.workspaceId,
					reason,
					message: read.error?.message ?? "Could not read this workspace's ledger.",
				};
			}
			unreadable[resolution.workspaceId] = { reason };
			continue;
		}
		const items = read.items
			.filter((item) => (input.status ? item.status === input.status : item.status === "open"))
			.filter((item) => (input.axis ? item.axis === input.axis : true));
		groups[resolution.workspaceId] = {
			provider: resolution.provider,
			workspaceFrom: resolution.workspaceFrom,
			providerFrom: resolution.providerFrom,
			count: items.length,
			unclassified: items.filter((item) => !item.axis).length,
			extraFields: read.extraFields,
			capabilities: resolution.adapter.capabilities(),
			items: items.map((item) => ({ ...item, qualifiedId: qualifyId(resolution.workspaceId, item.id) })),
		};
	}

	return { kind: "ok", groups, unreadable };
}

function buildListCommand(io: IssuesIo): Command {
	return new Command("list")
		.description("List a workspace's work items")
		.option("--workspace <id>", "Declared workspace id")
		.option("--all-workspaces", "Every declared workspace, grouped and never merged")
		.option("--axis <axis>", `Filter by axis: ${WORK_ITEM_AXES.join(", ")}`)
		.option("--status <status>", "Filter by status: open, deferred, or resolved (default: open)")
		.option("--json", "Output machine-readable list")
		.action((options: IssuesListOptions) => {
			const cwd = currentDirectoryForCatalogMatch();
			const outcome = buildIssuesList({ ...options, cwd, ...io });

			if (outcome.kind === "refusal") {
				refuse("list", outcome.resolution, options.json);
				return;
			}
			if (outcome.kind === "read-failure") {
				refuseAfterResolution("list", outcome.workspaceId, outcome.reason, outcome.message, options.json);
				return;
			}

			const { groups, unreadable } = outcome;
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "issues",
						operation: "list",
						nextCommands: [],
						extra: options.allWorkspaces ? { workspaces: groups, unreadable } : (Object.values(groups)[0] ?? {}),
					}),
				);
				return;
			}
			for (const [id, group] of Object.entries(groups)) {
				console.log(`${id}: ${group.count} open (${group.unclassified} unclassified)`);
			}
			for (const [id, reason] of Object.entries(unreadable)) {
				console.log(chalk.yellow(`${id}: unreadable — ${JSON.stringify(reason)}`));
			}
		});
}

const ADD_REQUIRED_FIELDS = ["id", "title", "body", "location", "category", "priority", "package"] as const;

interface IssuesAddOptions {
	workspace?: string;
	id?: string;
	title?: string;
	body?: string;
	location?: string;
	category?: string;
	priority?: string;
	package?: string;
	axis?: string;
	dryRun?: boolean;
	json?: boolean;
}

function buildAddCommand(io: IssuesIo): Command {
	return new Command("add")
		.description("Add a work item to a workspace's ledger")
		.option("--workspace <id>", "Declared workspace id")
		.option("--id <id>", "Work item id")
		.option("--title <title>", "Work item title")
		.option("--body <body>", "Work item body")
		.option("--location <location>", "Where the work item concerns (e.g. a file or component)")
		.option("--category <category>", "Work item category")
		.option("--priority <priority>", "Work item priority")
		.option("--package <package>", "Owning package or workspace path")
		.option("--axis <axis>", `Axis: ${WORK_ITEM_AXES.join(", ")}`)
		.option("--dry-run", "Validate without writing")
		.option("--json", "Output machine-readable result")
		.action((options: IssuesAddOptions) => {
			const cwd = currentDirectoryForCatalogMatch();
			const resolution = resolveWorkspaceLedger({ workspace: options.workspace, cwd, ...io });
			if (!resolution.ok) {
				refuse("add", resolution, options.json);
				return;
			}

			const missing = ADD_REQUIRED_FIELDS.filter((field) => !options[field]?.trim());
			if (missing.length > 0) {
				refuseAfterResolution(
					"add",
					resolution.workspaceId,
					"missing_fields",
					`Missing required field(s): ${missing.map((field) => `--${field}`).join(", ")}.`,
					options.json,
				);
				return;
			}

			if (options.axis && !WORK_ITEM_AXES.includes(options.axis as WorkItemAxis)) {
				refuseAfterResolution(
					"add",
					resolution.workspaceId,
					"invalid_axis",
					`--axis must be one of: ${WORK_ITEM_AXES.join(", ")}.`,
					options.json,
				);
				return;
			}

			const item: WorkItem = {
				id: options.id!.trim(),
				title: options.title!.trim(),
				body: options.body!.trim(),
				location: options.location!.trim(),
				status: "open",
				priority: options.priority!.trim(),
				category: options.category!.trim(),
				package: options.package!.trim(),
				axis: options.axis as WorkItemAxis | undefined,
			};

			const unsupported = rejectUnsupportedFields(resolution.adapter.capabilities(), item);
			if (unsupported.length > 0) {
				refuseAfterResolution(
					"add",
					resolution.workspaceId,
					"field_unsupported",
					`This workspace's provider (${resolution.provider}) cannot carry: ${unsupported.join(", ")}.`,
					options.json,
				);
				return;
			}

			const qualifiedId = qualifyId(resolution.workspaceId, item.id);
			if (options.dryRun) {
				if (options.json) {
					printJson(
						buildJsonSuccessEnvelope({
							command: "issues",
							operation: "add",
							nextCommands: [],
							extra: {
								workspaceId: resolution.workspaceId,
								workspaceFrom: resolution.workspaceFrom,
								providerFrom: resolution.providerFrom,
								dryRun: true,
								item: { ...item, qualifiedId },
							},
						}),
					);
				} else {
					console.log(chalk.yellow(`Dry run — would add ${qualifiedId}.`));
				}
				return;
			}

			const result = resolution.adapter.add(item);
			if (!result.ok || !result.item) {
				refuseAfterResolution(
					"add",
					resolution.workspaceId,
					result.error?.reason ?? "write_failed",
					result.error?.message ?? "Could not add the work item.",
					options.json,
				);
				return;
			}

			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "issues",
						operation: "add",
						nextCommands: [],
						extra: {
							workspaceId: resolution.workspaceId,
							workspaceFrom: resolution.workspaceFrom,
							providerFrom: resolution.providerFrom,
							item: { ...result.item, qualifiedId },
						},
					}),
				);
				return;
			}
			console.log(chalk.green(`Added ${qualifiedId}.`));
		});
}

interface IssuesSetStatusOptions {
	workspace?: string;
	id?: string;
	status?: string;
	resolvedBy?: string;
	json?: boolean;
}

function buildSetStatusCommand(io: IssuesIo): Command {
	return new Command("set-status")
		.description("Set a work item's status")
		.option("--workspace <id>", "Declared workspace id")
		.option("--id <id>", "Work item id")
		.option("--status <status>", `Status: ${WORK_ITEM_STATUSES.join(", ")}`)
		.option("--resolved-by <ref>", "Commit or reference resolving this item (required for status=resolved)")
		.option("--json", "Output machine-readable result")
		.action((options: IssuesSetStatusOptions) => {
			const cwd = currentDirectoryForCatalogMatch();
			const resolution = resolveWorkspaceLedger({ workspace: options.workspace, cwd, ...io });
			if (!resolution.ok) {
				refuse("set-status", resolution, options.json);
				return;
			}

			if (!options.id?.trim()) {
				refuseAfterResolution(
					"set-status",
					resolution.workspaceId,
					"missing_id",
					"Missing required field: --id.",
					options.json,
				);
				return;
			}
			if (!options.status || !WORK_ITEM_STATUSES.includes(options.status as WorkItemStatus)) {
				refuseAfterResolution(
					"set-status",
					resolution.workspaceId,
					"invalid_status",
					`--status must be one of: ${WORK_ITEM_STATUSES.join(", ")}.`,
					options.json,
				);
				return;
			}

			const result = resolution.adapter.setStatus(
				options.id.trim(),
				options.status as WorkItemStatus,
				options.resolvedBy,
			);
			if (!result.ok || !result.item) {
				refuseAfterResolution(
					"set-status",
					resolution.workspaceId,
					result.error?.reason ?? "write_failed",
					result.error?.message ?? "Could not update the work item.",
					options.json,
				);
				return;
			}

			const qualifiedId = qualifyId(resolution.workspaceId, result.item.id);
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "issues",
						operation: "set-status",
						nextCommands: [],
						extra: {
							workspaceId: resolution.workspaceId,
							workspaceFrom: resolution.workspaceFrom,
							providerFrom: resolution.providerFrom,
							item: { ...result.item, qualifiedId },
						},
					}),
				);
				return;
			}
			console.log(chalk.green(`Updated ${qualifiedId} → ${result.item.status}.`));
		});
}

export function createIssuesCommand(io: IssuesIo = defaultIo): Command {
	const command = new Command("issues").description(
		"Work items for a declared workspace's ledger — resolved through the catalog, never the cwd",
	);
	command.addCommand(buildListCommand(io));
	command.addCommand(buildAddCommand(io));
	command.addCommand(buildSetStatusCommand(io));
	return command;
}

export const issuesCommand = createIssuesCommand();
