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
		commands = record.commands as Record<string, WorkspaceDeclaredCommand>;
	}

	if (record.execution !== undefined) {
		if (
			typeof record.execution !== "object" ||
			record.execution === null ||
			Array.isArray(record.execution)
		) {
			return { error: `"execution" must be an object, got ${describeValue(record.execution)}.` };
		}
		return { offer: { commands, execution: record.execution as { preferredAdapter?: string } } };
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
