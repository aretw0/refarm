/**
 * A workspace's own declaration — an OFFER, never an instruction and never a catalog.
 *
 * Measured on 2026-08-06 (`docs/superpowers/specs/2026-08-06-a-workspace-is-not-a-node-design.md`):
 * `refarm workspace add --local` already distinguishes PLACE (a workspace's local
 * `.refarm/` versus the operator's home), but both places wrote the same SHAPE — a
 * `workspaces` map. That gave a workspace exactly one grammar for describing itself:
 * "a catalog of workspaces." The refarm repository used it to declare itself AND a
 * second, unrelated workspace, while the node's own catalog knew about only one of them.
 *
 * This module is the grammar that cannot say that. A workspace declaration may state
 * what it OFFERS — `commands` and `execution` — and nothing about WHO administers it or
 * WHERE it lives. Those are the node's to say, in the node's own catalog
 * (`~/.refarm/config.json`, written by `refarm workspace add`). `parseWorkspaceOffer`
 * refuses — never silently drops — any key that belongs to that other grammar, because
 * an ignored declaration is still believed by whoever wrote it, which is worse than a
 * rejected one.
 */
import path from "node:path";
import { refarmCommand } from "../brand.js";
import type { WorkspaceDeclaredCommand } from "./workspace.js";

/** A workspace's own declaration: what it offers to a node that might administer it.
 *  Reuses `WorkspaceDeclaredCommand` (`./workspace.ts`) rather than defining a second
 *  command shape — two shapes for one concept is the defect this file exists to end. */
export interface WorkspaceOffer {
	commands: Record<string, WorkspaceDeclaredCommand>;
	execution?: { preferredAdapter?: string };
}

/** The `{ value } | { error }` idiom this codebase already uses — see
 *  `parseWorkspaceOption` in `./dispatch-capability.ts`. A malformed declaration is
 *  refused, never thrown. */
export type ParsedOffer = { offer: WorkspaceOffer } | { error: string };

const WORKSPACE_ADD_COMMAND = refarmCommand(["workspace", "add"]);

/** Where the node's catalog lives — named in every refusal below so the message
 *  teaches the correct grammar rather than just rejecting the wrong one. */
const NODE_CATALOG_PATH = "~/.refarm/config.json";

/**
 * Keys that only mean something in the NODE's catalog entry for a workspace
 * (`~/.refarm/config.json`'s `workspaces.<id>`: `{ path, kind, repository?, bridges?,
 * cache?, commands? }`) — "who I administer" and "where it is." A workspace's own
 * declaration is the other half, "what I offer," and never states these. Declaring them
 * here is the exact two-roles-in-one-field collapse this file exists to separate, so
 * each is refused by name rather than ignored.
 */
const NODE_ONLY_KEYS = [
	"workspaces", // the catalog map itself — declaring who exists is the node's alone
	"path", // where a workspace IS is the node's to say
	"id", // the catalog's map key, never chosen by the workspace itself
	"kind", // refarm | consumer | lab | vault | project — a node classification
	"repository", // where to fetch the workspace from — the node's cache concern
	"bridges", // devcontainer mount bridging — the node's runtime concern
	"cache", // remote/local cache wiring — the node's execution concern
] as const;

const ALLOWED_OFFER_KEYS = new Set(["commands", "execution"]);

/** The exact field set `WorkspaceDeclaredCommand` (`./workspace.ts`) carries — checked
 *  here so an unrecognised key inside ONE command entry is refused rather than silently
 *  dropped, the same discipline applied at the top level. */
const ALLOWED_COMMAND_KEYS = new Set(["run", "cwd", "description", "remote", "result"]);

/** `WorkspaceOffer["execution"]` carries exactly one field today. Refusing anything else
 *  keeps a future field from arriving unreviewed through this same seam. */
const ALLOWED_EXECUTION_KEYS = new Set(["preferredAdapter"]);

function describeValue(value: unknown): string {
	if (value === undefined) return "undefined";
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function quoteAll(keys: string[]): string {
	return keys.map((key) => `"${key}"`).join(", ");
}

function nodeCatalogRefusal(keys: string[]): string {
	return (
		`A workspace declaration cannot contain ${quoteAll(keys)} — that is the node's catalog ` +
		`shape (which workspaces exist, and where), not a workspace's offer (what it offers). ` +
		`A workspace never declares itself or any other workspace; only a node does that, in its ` +
		`own catalog at ${NODE_CATALOG_PATH}. Run \`${WORKSPACE_ADD_COMMAND}\` from the node to ` +
		`declare this there instead.`
	);
}

/**
 * Validate ONE `commands.<name>` entry against the real `WorkspaceDeclaredCommand`
 * shape (`./workspace.ts`) — not a cast. This is the boundary a malformed declaration
 * must clear BEFORE Task 2 can write it into the node's own catalog by acceptance; a
 * shape unchecked here is a shape reviewed only by accident, the moment it fails to run.
 *
 * `run` is the field that becomes an executed process, so it is held to the tightest
 * rule: present, an array, non-empty, and every element a string. The optional fields
 * mirror `normalizeWorkspaceCommands` (`@refarm.dev/config`): `remote` accepted only as
 * exactly `true` and `result` only as exactly `"operation-result.v1"` — fail-closed, no
 * truthy coercion — so this parser and the node's own normalizer never diverge on what
 * counts as "set."
 */
function parseCommandEntry(
	name: string,
	raw: unknown,
): { command: WorkspaceDeclaredCommand } | { error: string } {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { error: `command "${name}": must be an object, found ${describeValue(raw)}.` };
	}
	const record = raw as Record<string, unknown>;

	const unknownKeys = Object.keys(record).filter((key) => !ALLOWED_COMMAND_KEYS.has(key));
	if (unknownKeys.length > 0) {
		return {
			error:
				`command "${name}": unrecognized ${quoteAll(unknownKeys)}. Only "run", "cwd", ` +
				`"description", "remote", and "result" are accepted.`,
		};
	}

	const run = record.run;
	if (!Array.isArray(run) || run.length === 0 || !run.every((item) => typeof item === "string")) {
		return {
			error: `command "${name}": "run" must be a non-empty array of strings, found ${describeValue(run)}.`,
		};
	}
	const command: WorkspaceDeclaredCommand = { run: run as string[] };

	if (record.cwd !== undefined) {
		if (typeof record.cwd !== "string") {
			return { error: `command "${name}": "cwd" must be a string, found ${describeValue(record.cwd)}.` };
		}
		command.cwd = record.cwd;
	}
	if (record.description !== undefined) {
		if (typeof record.description !== "string") {
			return {
				error: `command "${name}": "description" must be a string, found ${describeValue(record.description)}.`,
			};
		}
		command.description = record.description;
	}
	if (record.remote !== undefined) {
		if (record.remote !== true) {
			return {
				error: `command "${name}": "remote" must be exactly true when present, found ${describeValue(record.remote)}.`,
			};
		}
		command.remote = true;
	}
	if (record.result !== undefined) {
		if (record.result !== "operation-result.v1") {
			return {
				error: `command "${name}": "result" must be exactly "operation-result.v1" when present, found ${describeValue(record.result)}.`,
			};
		}
		command.result = "operation-result.v1";
	}

	return { command };
}

/** Validate `execution` against its one known field, refusing unknown nested keys
 *  rather than passing the object through — the same discipline `parseCommandEntry`
 *  applies to a command entry, one level down from the top-level grammar. */
function parseExecutionOffer(
	raw: Record<string, unknown>,
): { execution: { preferredAdapter?: string } } | { error: string } {
	const unknownKeys = Object.keys(raw).filter((key) => !ALLOWED_EXECUTION_KEYS.has(key));
	if (unknownKeys.length > 0) {
		return {
			error: `"execution": unrecognized ${quoteAll(unknownKeys)}. Only "preferredAdapter" is accepted.`,
		};
	}
	if (raw.preferredAdapter === undefined) return { execution: {} };
	if (typeof raw.preferredAdapter !== "string") {
		return {
			error: `"execution.preferredAdapter" must be a string, found ${describeValue(raw.preferredAdapter)}.`,
		};
	}
	return { execution: { preferredAdapter: raw.preferredAdapter } };
}

/**
 * Parse a raw JSON value into a workspace's OFFER. Refuses — never silently drops — any
 * key belonging to the node's catalog grammar (`workspaces`, `path`, `kind`,
 * `repository`, `bridges`, `cache`, `id`), and refuses the whole declaration even when a
 * refused key sits beside otherwise-valid `commands`/`execution`: partial acceptance
 * would teach that the wrong shape is tolerated.
 */
export function parseWorkspaceOffer(raw: unknown): ParsedOffer {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { error: `A workspace declaration must be a JSON object, got ${describeValue(raw)}.` };
	}
	const record = raw as Record<string, unknown>;

	const nodeKeysFound = Object.keys(record).filter((key) =>
		(NODE_ONLY_KEYS as readonly string[]).includes(key),
	);
	if (nodeKeysFound.length > 0) {
		return { error: nodeCatalogRefusal(nodeKeysFound) };
	}

	const unknownKeys = Object.keys(record).filter((key) => !ALLOWED_OFFER_KEYS.has(key));
	if (unknownKeys.length > 0) {
		return {
			error:
				`A workspace declaration does not recognize ${quoteAll(unknownKeys)}. ` +
				`Only "commands" and "execution" are accepted here — an offer, nothing more.`,
		};
	}

	let commands: Record<string, WorkspaceDeclaredCommand> = {};
	if (record.commands !== undefined) {
		if (typeof record.commands !== "object" || record.commands === null || Array.isArray(record.commands)) {
			return {
				error: `"commands" must be an object mapping command names to declarations, got ${describeValue(record.commands)}.`,
			};
		}
		const rawCommands = record.commands as Record<string, unknown>;
		const validated: Record<string, WorkspaceDeclaredCommand> = {};
		for (const [name, value] of Object.entries(rawCommands)) {
			const parsed = parseCommandEntry(name, value);
			if ("error" in parsed) return parsed;
			validated[name] = parsed.command;
		}
		commands = validated;
	}

	if (record.execution !== undefined) {
		if (
			typeof record.execution !== "object" ||
			record.execution === null ||
			Array.isArray(record.execution)
		) {
			return { error: `"execution" must be an object, got ${describeValue(record.execution)}.` };
		}
		const parsedExecution = parseExecutionOffer(record.execution as Record<string, unknown>);
		if ("error" in parsedExecution) return parsedExecution;
		return { offer: { commands, execution: parsedExecution.execution } };
	}

	return { offer: { commands } };
}

/**
 * The on-disk path for a workspace's own declaration: `workspace.json`, inside that
 * workspace's sovereign dir — never `config.json`. `config.json` is the node catalog's
 * file name; reusing it for a workspace's offer would let the node-shape and the
 * offer-shape collide on the same filename the way `.refarm/config.json` already
 * collided on disk before this file existed.
 */
export function workspaceOfferPath(workspaceAbsolutePath: string): string {
	return path.join(workspaceAbsolutePath, ".refarm", "workspace.json");
}
