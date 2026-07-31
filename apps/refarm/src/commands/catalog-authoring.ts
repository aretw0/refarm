import { defaultSovereignConfigPath, sovereignConfigRelativePath } from "@refarm.dev/config";
import {
	createFileOperationTrail,
	createNodeOperationFileSystem,
	renderOperationRequest,
	runOperationConsent,
	standingDecision,
	type OperationConsentChannel,
	type OperationFileSystem,
	type OperationInsertion,
	type OperationOutcome,
	type OperationRequest,
	type OperationTrail,
} from "@refarm.dev/operation-consent-v1";
import fs from "node:fs";
import path from "node:path";
import { configTrailPath, defaultDecidedBy } from "./config-record.js";

/**
 * DECLARING IS AUTHORING — the humane path to the same `.refarm/config.json`.
 *
 * Design: `docs/superpowers/specs/2026-07-31-declaring-is-authoring-design.md`.
 *
 * The declared-catalog doctrine (`connections`, `surfaces`, `workspaces`, `delivery`) bought
 * sovereignty and left authoring at "edit JSON by hand, knowing the vocabulary by heart". This
 * module is the other half: a wizard asks, shows the exact JSON, and the operator authorises —
 * and what gets written is **the same file, in the same vocabulary**. There is no second source
 * of truth, no sidecar state, no "wizard-managed" section. Hand-editing keeps working, and the
 * wizard reads what was hand-written.
 *
 * THE LINE THIS DOES NOT CROSS. Earlier in this repo a launch script SYNTHESISED the operator's
 * declaration with `jq`, and it was removed because it was right to refuse it. The difference is
 * not the file being written — it is who decided. A wizard **asks**, renders the exact change,
 * and applies nothing until the operator says yes through
 * `@refarm.dev/operation-consent-v1`. Inference is not authoring.
 *
 * WHAT IS GENERIC HERE, and what is not. This module knows about: catalog blocks in the sovereign
 * config, serialising an entry, computing the exact before/after, and the consent journey. It
 * knows nothing about delivery, connections, surfaces or workspaces — the questions belong to the
 * catalog, and only the questions. `delivery-add.ts` is the first consumer; the next one adds a
 * question set and nothing else.
 */

/** The context lines the proposal render shows — deliberately "all of them". R2 says the operator
 *  authorises a specific diff, and a diff you can only see three lines of is a category. */
const WHOLE_FILE = 100_000;

/** How a catalog declaration is remembered: `declare:<block>:<name>`.
 *
 * IDENTITY, never a nonce — `OperationRequest.id` is what lets a prior decision be recognised
 * instead of re-asked, and what makes every decision about one channel read as one timeline. */
export function catalogOperationId(block: string, name: string): string {
	return `declare:${block}:${name}`;
}

/** The kind recorded for a catalog declaration, per block. */
export function catalogOperationKind(block: string): string {
	return `declare-${block}`;
}

export interface CatalogEntryProposal {
	/** Catalog block in the sovereign config — `delivery`, `connections`, `surfaces`, `workspaces`. */
	block: string;
	/** The key inside the block: how the operator will refer to this entry. */
	name: string;
	/** The entry exactly as it will be serialised. Secret-free by construction: a declaration
	 *  NAMES where a secret comes from and never contains one. */
	entry: Record<string, unknown>;
	/** Sovereign root the config is read from and written to. */
	root: string;
	/** Injected so a test never needs a real `SOVEREIGN_DIR`. */
	env?: NodeJS.ProcessEnv;
}

export interface CatalogDeclarationPlan {
	block: string;
	name: string;
	/** Absolute path of the config file this writes. */
	configPath: string;
	/** The COMPLETE file before — `null` when it does not exist yet. */
	before: string | null;
	/** The COMPLETE file after. */
	after: string;
	/** The entry alone, rendered exactly as it appears in `after`. */
	entryJson: string;
	/** Where the entry lands, for the render. Always present: the operator sees the result. */
	insertion: OperationInsertion;
	/** An entry with this name already existed. */
	replaced: boolean;
	/** What it was, so a replacement can say what it displaces. Absent when it is new. */
	previousEntry?: unknown;
	/** The existing file is not in the canonical 2-space form, so writing it re-serialises the
	 *  whole file. Surfaced because the operator should see that in the diff, not discover it. */
	reserialised: boolean;
}

/** A config file that exists but cannot be parsed. Refused rather than overwritten. */
export class CatalogConfigUnreadableError extends Error {
	constructor(readonly configPath: string) {
		super(
			`${configPath} exists but is not valid JSON — refusing to rewrite a file I cannot read. ` +
				`Fix the JSON by hand, then run this again.`,
		);
		this.name = "CatalogConfigUnreadableError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lines, with a trailing newline read as a terminator rather than an empty last line. */
function splitLines(content: string): string[] {
	const lines = content.split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

/**
 * The entry as it appears inside the file: at depth 2 (root → block → entry), 2-space indent.
 *
 * Built by serialising the entry alone and re-indenting, so it is byte-identical to the run of
 * lines `JSON.stringify(config, null, 2)` produces — which is what makes locating it in the
 * result a search rather than a guess.
 */
function renderEntry(name: string, entry: Record<string, unknown>): string {
	const whole = JSON.stringify({ [name]: entry }, null, 2);
	return splitLines(whole)
		.slice(1, -1)
		.map((line) => `  ${line}`)
		.join("\n");
}

/** 1-based line number in `text` where `snippet`'s first line lands. */
function locateSnippet(text: string, snippet: string): number {
	const lines = splitLines(text);
	const first = snippet.split("\n")[0] ?? "";
	// The last line of an entry may gain a trailing comma when it is not the block's last key,
	// so the FIRST line — `    "name": {` — is the stable anchor.
	const index = lines.findIndex((line) => line === first);
	return index >= 0 ? index + 1 : 1;
}

/**
 * Compute the exact before/after for adding one entry to one catalog block. PURE apart from
 * reading the config file, which is the point: nothing is written here.
 *
 * A file that exists but does not parse is REFUSED. `loadRawSovereignConfig` reads missing and
 * malformed the same way (`null`), and acting on that would silently discard an operator's
 * broken-but-real configuration — the exact clobber this whole module exists to avoid.
 */
export function planCatalogDeclaration(proposal: CatalogEntryProposal): CatalogDeclarationPlan {
	const env = proposal.env ?? process.env;
	const configPath = defaultSovereignConfigPath(proposal.root, env);

	let before: string | null = null;
	try {
		before = fs.readFileSync(configPath, "utf-8");
	} catch {
		before = null;
	}

	let config: Record<string, unknown> = {};
	if (before !== null) {
		if (before.trim() === "") {
			config = {};
		} else {
			let parsed: unknown;
			try {
				parsed = JSON.parse(before);
			} catch {
				throw new CatalogConfigUnreadableError(configPath);
			}
			if (!isRecord(parsed)) throw new CatalogConfigUnreadableError(configPath);
			config = parsed;
		}
	}

	const existingBlock = config[proposal.block];
	if (existingBlock !== undefined && !isRecord(existingBlock)) {
		throw new CatalogConfigUnreadableError(configPath);
	}
	const block: Record<string, unknown> = { ...(existingBlock ?? {}) };
	const previousEntry = block[proposal.name];
	const replaced = proposal.name in block;
	block[proposal.name] = proposal.entry;

	const after = `${JSON.stringify({ ...config, [proposal.block]: block }, null, 2)}\n`;
	const entryJson = renderEntry(proposal.name, proposal.entry);
	const canonicalBefore = before === null ? null : `${JSON.stringify(config, null, 2)}\n`;

	return {
		block: proposal.block,
		name: proposal.name,
		configPath,
		before,
		after,
		entryJson,
		insertion: {
			line: locateSnippet(after, entryJson),
			text: entryJson,
			placement: replaced
				? `dentro do bloco "${proposal.block}", substituindo a declaração "${proposal.name}" que já estava lá`
				: `dentro do bloco "${proposal.block}", como "${proposal.name}"`,
		},
		replaced,
		...(previousEntry === undefined ? {} : { previousEntry }),
		reserialised: before !== null && canonicalBefore !== before,
	};
}

export interface CatalogOperationRequestInput {
	plan: CatalogDeclarationPlan;
	/** One line the operator reads first — the command they are authorising. */
	title: string;
	/** WHY, in the operator's terms. Carried into the record verbatim. */
	purpose: string;
	/** WHO is asking. */
	requester: string;
	requestedAt: string;
	/** Anything the diff alone does not say — a token file being written beside it, for instance. */
	notes?: string[];
}

/**
 * The request the operator decides on. PURE.
 *
 * The change set is the CONFIG FILE AND NOTHING ELSE. That is a deliberate boundary, not an
 * omission: an `OperationFileChange` carries full before/after snapshots into the durable trail,
 * so anything placed in it is anything written into `.refarm/operations.json`. A secret must
 * never be there. A wizard that writes a secret beside the declaration says so in `notes` and
 * writes it outside the change set — see `delivery-add.ts`.
 */
export function buildCatalogOperationRequest(
	input: CatalogOperationRequestInput,
): OperationRequest {
	const { plan } = input;
	const notes = [...(input.notes ?? [])];
	if (plan.replaced) {
		notes.push(
			`Já existe "${plan.name}" em "${plan.block}" — esta operação SUBSTITUI aquela declaração. ` +
				`O "como está agora" acima é o que sai.`,
		);
	}
	if (plan.reserialised) {
		notes.push(
			`O arquivo é reescrito em JSON canônico (2 espaços) — compare o "como fica" acima; ` +
				`os valores não mudam, só a formatação.`,
		);
	}
	return {
		id: catalogOperationId(plan.block, plan.name),
		kind: catalogOperationKind(plan.block),
		title: input.title,
		purpose: input.purpose,
		requester: input.requester,
		requestedAt: input.requestedAt,
		changes: [
			{
				path: plan.configPath,
				before: plan.before,
				after: plan.after,
				insertion: plan.insertion,
			},
		],
		undo: {
			kind: "restore-snapshot",
			summary:
				plan.before === null
					? `Remove ${plan.configPath} (não existia antes desta operação).`
					: `Restaura ${plan.configPath} exatamente como está agora.`,
		},
		...(notes.length > 0 ? { notes } : {}),
	};
}

/** The proposal as the operator reads it: the whole current file, the exact entry, the whole
 *  result. PURE — returns lines; the caller decides where they go. */
export function renderCatalogProposal(request: OperationRequest): string[] {
	return renderOperationRequest(request, { contextLines: WHOLE_FILE });
}

/** Where the trail for a catalog declaration lives: beside the config it describes, in the same
 *  `operations.json` `refarm config history` already reads. One place to answer "what has been
 *  configured here, and by whom", whether it came from `config set` or from a wizard. */
export function catalogTrailPath(configPath: string): string {
	return configTrailPath(configPath);
}

export interface AuthorCatalogDeclarationOptions {
	request: OperationRequest;
	/** `null` ⇒ nobody to ask. Nothing is prompted, read or recorded. */
	channel: OperationConsentChannel | null;
	trail?: OperationTrail;
	fs?: OperationFileSystem;
	now?: () => string;
	decidedBy?: string;
	host?: string;
	/** Deliberately re-open a question already answered — a replacement, or a reconsidered
	 *  refusal. The new record links back to the one it supersedes. */
	revisit?: boolean;
	announce?: (line: string) => void;
}

/**
 * Ask, show, decide, write, remember — the consent journey pointed at a catalog declaration.
 *
 * Thin on purpose. Everything load-bearing (ordering, rollback when the trail cannot be written,
 * decline as a first-class outcome, cancellation propagating with nothing applied) already lives
 * in `@refarm.dev/operation-consent-v1`; re-implementing any of it here would be a second answer
 * to a question that already has one.
 */
export async function authorCatalogDeclaration(
	options: AuthorCatalogDeclarationOptions,
): Promise<OperationOutcome> {
	const configPath = options.request.changes[0]?.path ?? "";
	const trail =
		options.trail ??
		createFileOperationTrail(
			catalogTrailPath(configPath),
			options.fs ?? createNodeOperationFileSystem(),
		);
	return runOperationConsent({
		request: options.request,
		trail,
		channel: options.channel,
		...(options.fs ? { fs: options.fs } : {}),
		...(options.now ? { now: options.now } : {}),
		decidedBy: options.decidedBy ?? defaultDecidedBy(),
		...(options.host ? { host: options.host } : {}),
		...(options.revisit ? { revisit: true } : {}),
		...(options.announce ? { announce: options.announce } : {}),
	});
}

/** Has the operator already decided about this exact declaration? Consulted BEFORE they are
 *  disturbed, so a re-run can say "you already answered this" rather than asking again. */
export async function standingCatalogDecision(
	trail: OperationTrail,
	block: string,
	name: string,
): Promise<ReturnType<typeof standingDecision>> {
	return standingDecision(await trail.read(), catalogOperationId(block, name));
}

/** The sovereign directory, RELATIVE to the root — `.refarm` unless `SOVEREIGN_DIR` says
 *  otherwise. What a declaration should reference, so the config stays portable. */
export function sovereignDirRelative(env: NodeJS.ProcessEnv = process.env): string {
	return path.dirname(sovereignConfigRelativePath(env));
}

/** The config file a catalog declaration is written to, absolute. */
export function catalogConfigPath(root: string, env: NodeJS.ProcessEnv = process.env): string {
	return defaultSovereignConfigPath(root, env);
}
