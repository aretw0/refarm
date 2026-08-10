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

/** The human-readable message for a `LedgerResolution` refusal — a real `switch` (not an object
 *  literal keyed by `reason`) so each branch narrows `resolution` and can reach the fields that
 *  exist ONLY on that branch, such as `provider_unsupported`'s `declaredProvider` /
 *  `implementedProviders`. Shared by `refuse()` (a single-workspace refusal, printed to the
 *  operator) and the `--all-workspaces` `unreadable` bucket in `buildIssuesList` (Finding 7 — that
 *  bucket used to carry only `reason`, discarding this exact text). */
function resolutionFailureMessage(resolution: LedgerRefusal): string {
	switch (resolution.reason) {
		case "no_such_workspace":
			return `No declared workspace with that id. Declared: ${resolution.declared.join(", ")}`;
		case "cwd_unmatched":
			return `This directory is inside no declared workspace. Declared: ${resolution.declared.join(", ")}. Pass --workspace <id>.`;
		case "no_provider":
			return "This workspace declares no work-item provider and has no .project/issues.json.";
		case "provider_unsupported":
			return `This workspace declares provider "${resolution.declaredProvider}", which has no adapter yet. Implemented: ${resolution.implementedProviders.join(", ")}.`;
	}
}

/** A refusal is an envelope, never a throw — the shape every subcommand below shares for a
 *  resolution failure (the workspace itself could not be resolved). */
function refuse(operation: string, resolution: LedgerRefusal, json?: boolean): void {
	const message = resolutionFailureMessage(resolution);
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

/** A refusal reached BEFORE any workspace resolution — `--axis`/`--status`/scope on `list` are
 *  invalid regardless of which workspace would have answered, so there is no `workspaceId` to
 *  point a handoff at yet (unlike `refuseAfterResolution`). Distinct from `refuse()` too, which
 *  refuses a `LedgerResolution` rather than a raw CLI input. */
function refuseInvalidListInput(reason: string, message: string, json?: boolean): void {
	const nextAction = refarmCommand(["issues", "list", "--help"]);
	if (json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "issues",
				operation: "list",
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
 * states this function must never collapse — a clean group, a named `unreadable` entry
 * under `--all-workspaces`, an outright refusal for a single-workspace failure, and an invalid
 * `--axis`/`--status`/scope combination — are each provable without going through a real process.
 *
 * THREE STATES, NEVER TWO, on a single-workspace read failure: this used to `continue` past a
 * failed `adapter.list()` exactly like the `--all-workspaces` branch does, which meant
 * `refarm issues list --workspace x --json` against a malformed ledger returned `ok: true` with
 * an EMPTY payload and exit 0 — a zero that was not a real zero, silently indistinguishable from
 * a workspace with no open items. `kind: "read-failure"` exists so the caller refuses instead.
 *
 * THE EIGHTH INSTANCE, Finding 1: `--axis` and `--status` used to be filter predicates that
 * simply matched nothing on a typo (`--axis costs`, `--status opne`), so `count: 0` was
 * indistinguishable from a workspace that genuinely has nothing left on that axis. `add`,
 * `set-status` and `set-axis` all validate this exact vocabulary and refuse; `list` did not, and
 * `list` is the verb `refarm resume`'s `nextCommand` hands to an agent. `kind: "invalid_input"`
 * exists so an unknown value refuses BEFORE any workspace is even resolved — the value is wrong
 * regardless of which workspace would have answered.
 */
export type IssuesListOutcome =
	| { kind: "refusal"; resolution: LedgerRefusal }
	| { kind: "invalid_input"; reason: string; message: string }
	| { kind: "read-failure"; workspaceId: string; reason: string; message: string }
	| {
			kind: "ok";
			groups: Record<string, ListedItemGroup>;
			unreadable: Record<string, { reason: string; message: string }>;
	  };

export interface BuildIssuesListInput extends IssuesIo {
	workspace?: string;
	allWorkspaces?: boolean;
	axis?: string;
	status?: string;
	cwd: string;
}

export function buildIssuesList(input: BuildIssuesListInput): IssuesListOutcome {
	// FINDING 4: `--workspace` silently ignored when `--all-workspaces` is also passed. Refuse the
	// combination rather than let one flag win invisibly.
	if (input.workspace && input.allWorkspaces) {
		return {
			kind: "invalid_input",
			reason: "conflicting_scope",
			message: "--workspace and --all-workspaces are mutually exclusive; pass exactly one.",
		};
	}
	// FINDING 1 (THE EIGHTH INSTANCE): validate against the same vocabulary `add`/`set-status`/
	// `set-axis` already enforce, and name the bad value AND the legal ones.
	if (input.axis !== undefined && !WORK_ITEM_AXES.includes(input.axis as WorkItemAxis)) {
		return {
			kind: "invalid_input",
			reason: "invalid_axis",
			message: `--axis "${input.axis}" is not valid. Legal axes: ${WORK_ITEM_AXES.join(", ")}.`,
		};
	}
	if (input.status !== undefined && !WORK_ITEM_STATUSES.includes(input.status as WorkItemStatus)) {
		return {
			kind: "invalid_input",
			reason: "invalid_status",
			message: `--status "${input.status}" is not valid. Legal statuses: ${WORK_ITEM_STATUSES.join(", ")}.`,
		};
	}

	const groups: Record<string, ListedItemGroup> = {};
	const unreadable: Record<string, { reason: string; message: string }> = {};
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
			// FINDING 7: carry the message alongside the reason — the spec's shape and `resume`'s
			// `LedgerSummary.unreadable` both carry it; this bucket used to drop it.
			unreadable[target ?? "(unresolved)"] = {
				reason: resolution.reason,
				message: resolutionFailureMessage(resolution),
			};
			continue;
		}
		const read = resolution.adapter.list();
		if (!read.ok) {
			const reason = read.error?.reason ?? "document_unreadable";
			const message = read.error?.message ?? "Could not read this workspace's ledger.";
			if (!input.allWorkspaces) {
				return {
					kind: "read-failure",
					workspaceId: resolution.workspaceId,
					reason,
					message,
				};
			}
			// FINDING 7: same carry-through as above, for the read-failure branch of the bucket.
			unreadable[resolution.workspaceId] = { reason, message };
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
			if (outcome.kind === "invalid_input") {
				refuseInvalidListInput(outcome.reason, outcome.message, options.json);
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

interface IssuesSetAxisOptions {
	workspace?: string;
	id?: string;
	axis?: string;
	json?: boolean;
}

/**
 * `set-axis` is a SEPARATE verb rather than an `--axis` flag on `set-status`, because the two
 * answer different questions: `set-status` moves an item through its lifecycle and refuses to
 * resolve without proof, while classification says which axis of open work an item belongs to and
 * is legal at any status. Folding it into `set-status` would have forced a caller reclassifying an
 * open item to restate `--status open` — a write of a value it did not intend to change, in a
 * command whose name would then be a small untruth about what it wrote.
 */
function buildSetAxisCommand(io: IssuesIo): Command {
	return new Command("set-axis")
		.description("Classify a work item that already exists")
		.option("--workspace <id>", "Declared workspace id")
		.option("--id <id>", "Work item id")
		.option("--axis <axis>", `Axis: ${WORK_ITEM_AXES.join(", ")}`)
		.option("--json", "Output machine-readable result")
		.action((options: IssuesSetAxisOptions) => {
			const cwd = currentDirectoryForCatalogMatch();
			const resolution = resolveWorkspaceLedger({ workspace: options.workspace, cwd, ...io });
			if (!resolution.ok) {
				refuse("set-axis", resolution, options.json);
				return;
			}

			if (!options.id?.trim()) {
				refuseAfterResolution(
					"set-axis",
					resolution.workspaceId,
					"missing_id",
					"Missing required field: --id.",
					options.json,
				);
				return;
			}
			// Validated HERE as well as in the adapter: the CLI refuses before any document is read,
			// and the adapter refuses even when a caller reaches it directly. An unknown axis must
			// never reach a write, from either door.
			if (!options.axis || !WORK_ITEM_AXES.includes(options.axis as WorkItemAxis)) {
				refuseAfterResolution(
					"set-axis",
					resolution.workspaceId,
					"invalid_axis",
					`--axis must be one of: ${WORK_ITEM_AXES.join(", ")}.`,
					options.json,
				);
				return;
			}

			const result = resolution.adapter.setAxis(options.id.trim(), options.axis as WorkItemAxis);
			if (!result.ok || !result.item) {
				refuseAfterResolution(
					"set-axis",
					resolution.workspaceId,
					result.error?.reason ?? "write_failed",
					result.error?.message ?? "Could not classify the work item.",
					options.json,
				);
				return;
			}

			const qualifiedId = qualifyId(resolution.workspaceId, result.item.id);
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "issues",
						operation: "set-axis",
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
			console.log(chalk.green(`Classified ${qualifiedId} → ${result.item.axis}.`));
		});
}

export interface IssuesValidateFinding {
	reason: "duplicate_id" | "open_without_axis" | "resolved_without_resolved_by";
	ids: string[];
	message: string;
}

export type IssuesValidateOutcome =
	| { kind: "refusal"; resolution: LedgerRefusal }
	| { kind: "read-failure"; workspaceId: string; reason: string; message: string }
	| {
			kind: "ok";
			workspaceId: string;
			provider: string;
			workspaceFrom: LedgerResolutionOk["workspaceFrom"];
			providerFrom: LedgerResolutionOk["providerFrom"];
			valid: boolean;
			counts: { total: number; open: number; deferred: number; resolved: number };
			findings: IssuesValidateFinding[];
			/** INFORMATION, never a finding. rcdc5's ledger legitimately carries `description` and
			 *  refarm's schema forbids it — a contract that failed on the difference would be wrong
			 *  about one of the two real workspaces on this node. */
			extraFields: string[];
	  };

export interface BuildIssuesValidateInput extends IssuesIo {
	workspace?: string;
	cwd: string;
}

/**
 * The pure core of `issues validate` — the same three-state posture as `buildIssuesList`: a
 * refusal (the workspace did not resolve), a read failure (the document is unreadable, which is a
 * distinct answer and NEVER an empty clean ledger), or a verdict. `valid: false` is a verdict, not
 * an error: the document was read and understood, and it breaks a rule the gate enforces.
 */
export function buildIssuesValidate(input: BuildIssuesValidateInput): IssuesValidateOutcome {
	const resolution = resolveWorkspaceLedger({
		workspace: input.workspace,
		cwd: input.cwd,
		loadWorkspaces: input.loadWorkspaces,
		fileExists: input.fileExists,
		readDocument: input.readDocument,
		writeDocument: input.writeDocument,
	});
	if (!resolution.ok) return { kind: "refusal", resolution };

	const read = resolution.adapter.list();
	if (!read.ok) {
		return {
			kind: "read-failure",
			workspaceId: resolution.workspaceId,
			reason: read.error?.reason ?? "document_unreadable",
			message: read.error?.message ?? "Could not read this workspace's ledger.",
		};
	}

	const seen = new Map<string, number>();
	for (const item of read.items) seen.set(item.id, (seen.get(item.id) ?? 0) + 1);
	const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
	const openWithoutAxis = read.items.filter((item) => item.status === "open" && !item.axis).map((item) => item.id);
	const resolvedWithoutRef = read.items
		.filter((item) => item.status === "resolved" && !item.resolvedBy?.trim())
		.map((item) => item.id);

	const findings: IssuesValidateFinding[] = [];
	if (duplicates.length > 0) {
		findings.push({
			reason: "duplicate_id",
			ids: duplicates,
			message: `${duplicates.length} id(s) appear more than once; ids must be unique within a workspace.`,
		});
	}
	if (openWithoutAxis.length > 0) {
		findings.push({
			reason: "open_without_axis",
			ids: openWithoutAxis,
			message: `${openWithoutAxis.length} open item(s) carry no axis; the gate requires one for status: open.`,
		});
	}
	if (resolvedWithoutRef.length > 0) {
		findings.push({
			reason: "resolved_without_resolved_by",
			ids: resolvedWithoutRef,
			message: `${resolvedWithoutRef.length} resolved item(s) name no resolved_by; "resolved" without proof is an assertion.`,
		});
	}

	return {
		kind: "ok",
		workspaceId: resolution.workspaceId,
		provider: resolution.provider,
		workspaceFrom: resolution.workspaceFrom,
		providerFrom: resolution.providerFrom,
		valid: findings.length === 0,
		counts: {
			total: read.items.length,
			open: read.items.filter((item) => item.status === "open").length,
			deferred: read.items.filter((item) => item.status === "deferred").length,
			resolved: read.items.filter((item) => item.status === "resolved").length,
		},
		findings,
		extraFields: read.extraFields,
	};
}

/** One remediation command per finding kind, named with the FIRST offending id so the handoff is
 *  runnable rather than a category. A duplicate id has no writer that can fix it — `add` refuses to
 *  create one, so a duplicate arrived by hand — and the honest handoff is to look at the document. */
function validateNextCommands(workspaceId: string, findings: IssuesValidateFinding[]): string[] {
	return findings.map((finding) => {
		const id = finding.ids[0] ?? "<id>";
		if (finding.reason === "open_without_axis") {
			return refarmCommand(["issues", "set-axis", "--workspace", workspaceId, "--id", id, "--axis", "other", "--json"]);
		}
		if (finding.reason === "resolved_without_resolved_by") {
			return refarmCommand([
				"issues",
				"set-status",
				"--workspace",
				workspaceId,
				"--id",
				id,
				"--status",
				"resolved",
				"--resolved-by",
				"<commit>",
				"--json",
			]);
		}
		return refarmCommand(["issues", "list", "--workspace", workspaceId, "--status", "open", "--json"]);
	});
}

function buildValidateCommand(io: IssuesIo): Command {
	return new Command("validate")
		.description("Check a workspace's ledger against the rules the gate enforces")
		.option("--workspace <id>", "Declared workspace id")
		.option("--json", "Output machine-readable result")
		.action((options: { workspace?: string; json?: boolean }) => {
			const cwd = currentDirectoryForCatalogMatch();
			const outcome = buildIssuesValidate({ workspace: options.workspace, cwd, ...io });

			if (outcome.kind === "refusal") {
				refuse("validate", outcome.resolution, options.json);
				return;
			}
			if (outcome.kind === "read-failure") {
				refuseAfterResolution("validate", outcome.workspaceId, outcome.reason, outcome.message, options.json);
				return;
			}

			const nextCommands = validateNextCommands(outcome.workspaceId, outcome.findings);
			const payload = {
				workspaceId: outcome.workspaceId,
				provider: outcome.provider,
				workspaceFrom: outcome.workspaceFrom,
				providerFrom: outcome.providerFrom,
				valid: outcome.valid,
				counts: outcome.counts,
				findings: outcome.findings,
				extraFields: outcome.extraFields,
			};

			if (!outcome.valid) {
				const primaryCommand =
					nextCommands[0] ?? refarmCommand(["issues", "list", "--workspace", outcome.workspaceId, "--json"]);
				if (options.json) {
					printJson(
						buildJsonErrorEnvelope({
							command: "issues",
							operation: "validate",
							error: "invalid_ledger",
							message: outcome.findings.map((finding) => finding.message).join(" "),
							nextAction: "Fix each finding, then re-run validate — the commands below are runnable as printed.",
							nextCommand: primaryCommand,
							nextCommands,
							extra: payload,
						}),
					);
				} else {
					for (const finding of outcome.findings) {
						console.error(chalk.red(`${finding.reason}: ${finding.message} (${finding.ids.join(", ")})`));
					}
				}
				process.exitCode = 1;
				return;
			}

			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "issues",
						operation: "validate",
						nextCommands: [],
						extra: payload,
					}),
				);
				return;
			}
			console.log(
				chalk.green(
					`${outcome.workspaceId}: ${outcome.counts.total} item(s) valid — ${outcome.counts.open} open, ${outcome.counts.deferred} deferred, ${outcome.counts.resolved} resolved.`,
				),
			);
			if (outcome.extraFields.length > 0) {
				console.log(chalk.dim(`extra fields carried by this backend: ${outcome.extraFields.join(", ")}`));
			}
		});
}

interface IssuesEditOptions {
	workspace?: string;
	id?: string;
	title?: string;
	body?: string;
	location?: string;
	json?: boolean;
}

/**
 * `edit` corrects what an item SAYS. It is one verb with three optional flags, not three verbs
 * beside `set-status` and `set-axis`, because those two are separate for a reason that does not
 * apply here: lifecycle and classification are different questions about an item, while title, body
 * and location are three answers to the same one.
 *
 * ISS-085 is the reason it exists, and the cost was measured rather than imagined: in the session
 * that built it, two item bodies were corrupted by a shell string executing their backticks, two
 * were repaired by editing `.project/issues.json` directly, and one item carried a hypothesis proven
 * wrong with no way to correct the sentence that stated it. A governed document whose only editor is
 * a text editor is the writer-gap that killed `tasks.json` and `issues.json` the first time.
 */
function buildEditCommand(io: IssuesIo): Command {
	return new Command("edit")
		.description("Correct a work item's title, body or location")
		.option("--workspace <id>", "Declared workspace id")
		.option("--id <id>", "Work item id")
		.option("--title <title>", "Replacement title")
		.option("--body <body>", "Replacement body")
		.option("--location <location>", "Replacement location")
		.option("--json", "Output machine-readable result")
		.action((options: IssuesEditOptions) => {
			const cwd = currentDirectoryForCatalogMatch();
			const resolution = resolveWorkspaceLedger({ workspace: options.workspace, cwd, ...io });
			if (!resolution.ok) {
				refuse("edit", resolution, options.json);
				return;
			}
			if (!options.id?.trim()) {
				refuseAfterResolution("edit", resolution.workspaceId, "missing_id", "Missing required field: --id.", options.json);
				return;
			}

			const fields: { title?: string; body?: string; location?: string } = {};
			if (options.title !== undefined) fields.title = options.title;
			if (options.body !== undefined) fields.body = options.body;
			if (options.location !== undefined) fields.location = options.location;

			const result = resolution.adapter.editText(options.id.trim(), fields);
			if (!result.ok || !result.item) {
				refuseAfterResolution(
					"edit",
					resolution.workspaceId,
					result.error?.reason ?? "write_failed",
					result.error?.message ?? "Could not edit the work item.",
					options.json,
				);
				return;
			}

			const qualifiedId = qualifyId(resolution.workspaceId, result.item.id);
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "issues",
						operation: "edit",
						nextCommands: [],
						extra: {
							workspaceId: resolution.workspaceId,
							workspaceFrom: resolution.workspaceFrom,
							providerFrom: resolution.providerFrom,
							edited: Object.keys(fields),
							item: { ...result.item, qualifiedId },
						},
					}),
				);
				return;
			}
			console.log(chalk.green(`Edited ${qualifiedId}: ${Object.keys(fields).join(", ")}.`));
		});
}

export function createIssuesCommand(io: IssuesIo = defaultIo): Command {
	const command = new Command("issues").description(
		"Work items for a declared workspace's ledger — resolved through the catalog, never the cwd",
	);
	command.addCommand(buildListCommand(io));
	command.addCommand(buildAddCommand(io));
	command.addCommand(buildSetStatusCommand(io));
	command.addCommand(buildSetAxisCommand(io));
	command.addCommand(buildEditCommand(io));
	command.addCommand(buildValidateCommand(io));
	return command;
}

export const issuesCommand = createIssuesCommand();
