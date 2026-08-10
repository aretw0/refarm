/**
 * `refarm requirements` — the operator's requirement record, and the counting surface that answers
 * "how many open items stand between me and R7".
 *
 * WHY IT EXISTS AT ALL: `.project/requirements.json` sat 2,702 commits untouched with 31 May-era
 * entries, while the twelve requirements the operator actually works to lived in Markdown where no
 * instrument could see them (ISS-089). The 2026-08-08 slice named the cause and it is structural
 * rather than cultural — a governed document whose only editor is a text editor stops receiving
 * reality. `set-maturity` is this document's editor. It arrives in the same commit that turns the
 * Markdown into an index, deliberately: converting first and adding the writer later would recreate
 * the exact defect with the appearance of progress.
 *
 * The catalog is read as the SIBLING of the workspace's work-item document, through the resolution
 * `resolveWorkspaceLedger` already performs — never a second resolver, which would be a second place
 * for "which workspace, and where does its .project/ live" to drift.
 */
import { buildJsonErrorEnvelope, buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { resolveWorkspaceLedger, type LedgerWorkspace } from "@refarm.dev/cli";
import { declaredBase, declaredWorkspacesFromConfig, loadConfig } from "@refarm.dev/config";
import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";

import { refarmCommand } from "../brand.js";

/** The operator's six-state vocabulary, verbatim from `docs/OPERATOR_REQUIREMENTS.md`. Portuguese
 *  tokens because the table that DEFINES them is: an English enum would be a second vocabulary
 *  needing a mapping nobody maintains. */
export const REQUIREMENT_MATURITIES = [
	"provado",
	"parcial",
	"projetado",
	"ausente",
	"decisao-do-operador",
	"desconhecido",
] as const;

interface RequirementRecord {
	id: string;
	title?: string;
	maturity?: string;
	status?: string;
	evidence?: string[];
	[key: string]: unknown;
}

export interface RequirementsIo {
	loadWorkspaces: () => LedgerWorkspace[];
	fileExists: (candidate: string) => boolean;
	readDocument: (candidate: string) => string;
	writeDocument: (candidate: string, contents: string) => void;
}

function defaultLoadWorkspaces(): LedgerWorkspace[] {
	const baseDir = declaredBase();
	return declaredWorkspacesFromConfig(loadConfig(baseDir), { baseDir }).filter(
		(workspace): workspace is NonNullable<typeof workspace> => workspace !== null,
	);
}

const defaultIo: RequirementsIo = {
	loadWorkspaces: defaultLoadWorkspaces,
	fileExists: (candidate: string) => fs.existsSync(candidate),
	readDocument: (candidate: string) => fs.readFileSync(candidate, "utf-8"),
	writeDocument: (candidate: string, contents: string) => fs.writeFileSync(candidate, contents),
};

/** THE ONE DELIBERATE cwd READ in this module — matched against the declared catalog and never a
 *  path anything is read from. Named, for the same reason `issues.ts` names its own. */
function currentDirectoryForCatalogMatch(): string {
	return process.cwd();
}

function refuse(operation: string, reason: string, message: string, json?: boolean): void {
	const nextAction = refarmCommand(["workspace", "list", "--json"]);
	if (json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "requirements",
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

interface ResolvedCatalog {
	workspaceId: string;
	catalogPath: string;
	issuesPath: string;
	requirements: RequirementRecord[];
	raw: { requirements: RequirementRecord[] };
}

/** Resolves the workspace, then its requirement catalog as the sibling of its work-item document.
 *  Returns a refusal object rather than throwing: every failure here is an answer the operator can
 *  act on, and each names a DIFFERENT fix. */
function resolveCatalog(
	io: RequirementsIo,
	workspace: string | undefined,
): ResolvedCatalog | { error: { reason: string; message: string } } {
	const resolution = resolveWorkspaceLedger({ workspace, cwd: currentDirectoryForCatalogMatch(), ...io });
	if (!resolution.ok) {
		return { error: { reason: resolution.reason, message: `Could not resolve a workspace: ${resolution.reason}.` } };
	}
	const catalogPath = path.join(path.dirname(resolution.documentPath), "requirements.json");
	if (!io.fileExists(catalogPath)) {
		return {
			error: {
				reason: "no_requirement_catalog",
				message: `This workspace declares no requirement catalog (${catalogPath} does not exist).`,
			},
		};
	}
	let raw: { requirements?: unknown };
	try {
		raw = JSON.parse(io.readDocument(catalogPath));
	} catch (error) {
		return {
			error: {
				reason: "catalog_unreadable",
				message: `${catalogPath} could not be read: ${error instanceof Error ? error.message : String(error)}`,
			},
		};
	}
	const requirements = Array.isArray(raw.requirements) ? (raw.requirements as RequirementRecord[]) : [];
	return {
		workspaceId: resolution.workspaceId,
		catalogPath,
		issuesPath: resolution.documentPath,
		requirements,
		raw: { ...(raw as object), requirements } as { requirements: RequirementRecord[] },
	};
}

/** PURE. Per-requirement counts plus the unserved bucket.
 *
 * `counts` is `null` — never zeros — when the LEDGER could not be read. A count that means "nothing
 * left" and a count that means "nothing read" must not be the same value; that conflation is the
 * defect this entire line of work is named after. */
export function summariseRequirementCoverage(
	requirements: RequirementRecord[],
	items: { status: string; requirement?: string }[] | null,
): {
	requirements: Array<{ id: string; title?: string; maturity?: string; counts: { open: number } | null }>;
	unserved: { open: number } | null;
} {
	const openItems = items?.filter((item) => item.status === "open") ?? null;
	return {
		requirements: requirements.map((requirement) => ({
			id: requirement.id,
			...(requirement.title ? { title: requirement.title } : {}),
			...(requirement.maturity ? { maturity: requirement.maturity } : {}),
			counts: openItems ? { open: openItems.filter((item) => item.requirement === requirement.id).length } : null,
		})),
		unserved: openItems ? { open: openItems.filter((item) => !item.requirement).length } : null,
	};
}

function buildListCommand(io: RequirementsIo): Command {
	return new Command("list")
		.description("List the operator requirements with how many open items serve each")
		.option("--workspace <id>", "Declared workspace id")
		.option("--json", "Output machine-readable result")
		.action((options: { workspace?: string; json?: boolean }) => {
			const resolved = resolveCatalog(io, options.workspace);
			if ("error" in resolved) {
				refuse("list", resolved.error.reason, resolved.error.message, options.json);
				return;
			}
			let items: { status: string; requirement?: string }[] | null = null;
			let ledgerError: string | null = null;
			try {
				const parsed = JSON.parse(io.readDocument(resolved.issuesPath)) as { issues?: unknown };
				items = Array.isArray(parsed.issues) ? (parsed.issues as { status: string; requirement?: string }[]) : [];
			} catch (error) {
				ledgerError = error instanceof Error ? error.message : String(error);
			}
			const summary = summariseRequirementCoverage(resolved.requirements, items);

			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "requirements",
						operation: "list",
						nextCommands: [],
						extra: {
							workspaceId: resolved.workspaceId,
							catalogPath: resolved.catalogPath,
							catalog: { total: resolved.requirements.length, empty: resolved.requirements.length === 0 },
							// Three states, and the third is why `counts` can be null: the catalog was read
							// and the LEDGER was not, which is neither a clean zero nor a failure of this
							// command.
							ledger: { readable: ledgerError === null, reason: ledgerError },
							...summary,
						},
					}),
				);
				return;
			}
			// No prose in the text render: truncating a paragraph would need declaring, and the cheap
			// honest answer is not to truncate at all. `--json` carries every field.
			// Sorted by open count, then by whether the entry carries a maturity — which is what
			// distinguishes the operator's twelve from the 31 May-era entries without inventing a
			// `cohort` field for it. At equal counts his requirements come first, because they are
			// what he reads this table to decide. `--json` keeps every row in catalog order.
			for (const requirement of [...summary.requirements].sort(
				(left, right) =>
					(right.counts?.open ?? 0) - (left.counts?.open ?? 0) ||
					Number(Boolean(right.maturity)) - Number(Boolean(left.maturity)),
			)) {
				const open = requirement.counts ? String(requirement.counts.open) : "?";
				console.log(
					`${requirement.id.padEnd(16)} ${(requirement.maturity ?? "-").padEnd(20)} open ${open.padStart(3)}  ${requirement.title ?? ""}`,
				);
			}
			console.log(chalk.dim(`unserved: ${summary.unserved ? summary.unserved.open : "?"} open item(s) serve no requirement`));
			if (ledgerError) console.log(chalk.yellow(`the ledger could not be read (${ledgerError}) — counts are unknown, not zero`));
		});
}

function buildSetMaturityCommand(io: RequirementsIo): Command {
	return new Command("set-maturity")
		.description("Record what reality measures for a requirement")
		.option("--workspace <id>", "Declared workspace id")
		.option("--id <id>", "Requirement id (R1-R12)")
		.option("--maturity <state>", `One of: ${REQUIREMENT_MATURITIES.join(", ")}`)
		.option("--evidence <ref>", "A document, commit or command that sustains this state")
		.option("--json", "Output machine-readable result")
		.action((options: { workspace?: string; id?: string; maturity?: string; evidence?: string; json?: boolean }) => {
			const resolved = resolveCatalog(io, options.workspace);
			if ("error" in resolved) {
				refuse("set-maturity", resolved.error.reason, resolved.error.message, options.json);
				return;
			}
			if (!options.id?.trim()) {
				refuse("set-maturity", "missing_id", "Missing required field: --id.", options.json);
				return;
			}
			if (!options.maturity || !REQUIREMENT_MATURITIES.includes(options.maturity as never)) {
				refuse(
					"set-maturity",
					"invalid_maturity",
					`--maturity must be one of: ${REQUIREMENT_MATURITIES.join(", ")}.`,
					options.json,
				);
				return;
			}
			// The operator's own protocol, rule 6: "não elevar um requisito a Provado sem evidência
			// executada". Same precedent as `--status resolved` refusing without `--resolved-by`:
			// "proved" without evidence is an assertion.
			if (options.maturity === "provado" && !options.evidence?.trim()) {
				refuse(
					"set-maturity",
					"evidence_required",
					"Raising a requirement to `provado` requires --evidence <ref> — proved without evidence is an assertion.",
					options.json,
				);
				return;
			}
			const entry = resolved.requirements.find((candidate) => candidate.id === options.id?.trim());
			if (!entry) {
				refuse(
					"set-maturity",
					"unknown_requirement",
					`No requirement "${options.id}" in ${resolved.catalogPath}. Declared: ${resolved.requirements.map((r) => r.id).join(", ")}.`,
					options.json,
				);
				return;
			}

			// Mutated IN PLACE so every key the contract does not model, and the key ORDER, survive —
			// the same rule the work-item adapter's `withField` follows one document over.
			entry.maturity = options.maturity;
			const reference = options.evidence?.trim();
			if (reference) {
				entry.evidence = [...new Set([...(entry.evidence ?? []), reference])];
			}
			io.writeDocument(resolved.catalogPath, `${JSON.stringify(resolved.raw, null, 2)}\n`);

			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "requirements",
						operation: "set-maturity",
						nextCommands: [refarmCommand(["requirements", "list", "--workspace", resolved.workspaceId, "--json"])],
						extra: { workspaceId: resolved.workspaceId, catalogPath: resolved.catalogPath, requirement: entry },
					}),
				);
				return;
			}
			console.log(chalk.green(`${entry.id} is now ${entry.maturity}.`));
		});
}

export function createRequirementsCommand(io: RequirementsIo = defaultIo): Command {
	const command = new Command("requirements").description(
		"The operator's requirement record, and how many open items serve each",
	);
	command.addCommand(buildListCommand(io));
	command.addCommand(buildSetMaturityCommand(io));
	return command;
}

export const requirementsCommand = createRequirementsCommand();
