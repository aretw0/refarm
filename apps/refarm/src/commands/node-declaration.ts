/**
 * THE DECLARATION — a node as thirty kilobytes of readable decisions plus a sealed identity.
 *
 * Measured on the operator's node 2026-08-13: of 592 KB of irrecoverable state, the entire DECISION
 * surface is 5.5 KB and identity is 24.5 KB. History and storage are the other 95%, and no
 * declaration reproduces a record of the past. This module builds the 30 KB and refuses the rest.
 *
 * `declarations` IS `.refarm/config.json`, byte for byte. Not a projection of it, not a subset:
 * a re-encoding would be a second vocabulary, and `2026-07-31-declaring-is-authoring-design.md`
 * A2 forbids a second source of truth for exactly the reason it would rot.
 */
import { readSealState, type SealEnvelope } from "./node-seal.js";
import { classifyByLayout } from "./sovereign-layout.js";

/** Identity-bearing locations. Sealed even when the layout calls them `data`, because a certificate
 *  without its key restores a node that cannot present the identity it claims. */
const SEALED_EXACT = [".refarm/node-id", ".refarm/node.json"];
const SEALED_PREFIXES = [".refarm/tls/"];

/** PURE. Whether a path relative to the node home belongs inside the seal. */
export function isSealedPath(relative: string): boolean {
	const normalised = relative.split(/[\\/]/u).join("/");
	if (SEALED_EXACT.includes(normalised)) return true;
	if (SEALED_PREFIXES.some((prefix) => normalised.startsWith(prefix))) return true;
	// Declared namespaces are irrelevant here: nothing storage-shaped is ever sealed, so an empty
	// list cannot change the answer.
	return classifyByLayout(normalised, []).nature === "secret";
}

/** The two files the declaration carries in CLEARTEXT. Everything else is sealed or not carried. */
const DECISION_FILES = [".refarm/config.json", ".refarm/auth-policy.json"];
const STORAGE_DIRECTORIES = [".refarm/data/refarm/", ".local/share/refarm/"];

/** PURE. Whether the declaration carries this path at all, sealed or in the clear. */
export function isCarriedByDeclaration(relative: string): boolean {
	const normalised = relative.split(/[\\/]/u).join("/");
	return DECISION_FILES.includes(normalised) || isSealedPath(normalised);
}

/**
 * PURE. What the declaration leaves behind, counted by WHY it is left behind.
 *
 * History and storage are separated deliberately. History is gone for good — nothing reproduces a
 * record of the past. Storage is expected back by replication. One number covering both would tell
 * an operator how much he lost without telling him which half has a remedy.
 */
export function summariseNotCarried(
	files: readonly { relative: string; bytes: number }[],
): NodeDeclaration["notCarried"] {
	const left = files.filter((file) => !isCarriedByDeclaration(file.relative));
	const isStorage = (relative: string) =>
		STORAGE_DIRECTORIES.some((dir) => relative.split(/[\\/]/u).join("/").startsWith(dir));
	return {
		history: left.filter((file) => !isStorage(file.relative)).length,
		storage: left.filter((file) => isStorage(file.relative)).length,
		bytes: left.reduce((total, file) => total + file.bytes, 0),
		replicates: true,
	};
}

export interface NodeDeclaration {
	readonly $schema: "refarm/node-declaration.v1";
	readonly node: { readonly name: string; readonly declaredAt: string };
	readonly governance: "local" | "repo";
	readonly declarations: Record<string, unknown>;
	readonly authPolicy: Record<string, unknown> | null;
	readonly seal: SealEnvelope;
	readonly reAuthenticate: readonly string[];
	readonly notCarried: {
		readonly history: number;
		readonly storage: number;
		readonly bytes: number;
		readonly replicates: boolean;
	};
}

export interface BuildDeclarationInput {
	readonly nodeName: string;
	readonly declaredAt: string;
	readonly governance: "local" | "repo";
	readonly config: Record<string, unknown>;
	readonly authPolicy: Record<string, unknown> | null;
	readonly seal: SealEnvelope;
	readonly reAuthenticate: readonly string[];
	readonly notCarried: NodeDeclaration["notCarried"];
}

/** PURE. The document. Every field is supplied — this module reads nothing. */
export function buildDeclaration(input: BuildDeclarationInput): NodeDeclaration {
	return {
		$schema: "refarm/node-declaration.v1",
		node: { name: input.nodeName, declaredAt: input.declaredAt },
		governance: input.governance,
		declarations: input.config,
		authPolicy: input.authPolicy,
		seal: input.seal,
		reAuthenticate: [...input.reAuthenticate],
		notCarried: input.notCarried,
	};
}

/**
 * FOUR VERDICTS PER KEY, NEVER A BOOLEAN — and the vocabulary is chosen for the slice that has not
 * been built yet. Under `governance: "local"` a `node-only` key is pending emission; under `"repo"`
 * the same key is an unpromoted proposal. `refarm node promote` needs that distinction to exist
 * before it can be additive, which is why it is here now with only one consumer.
 */
export type KeyVerdict = "aligned" | "node-only" | "source-only" | "divergent";

export interface DeclarationDiff {
	readonly keys: readonly { readonly key: string; readonly verdict: KeyVerdict }[];
	/** `uncomparable` when the seal cannot be opened by this build — NOT `aligned`. */
	readonly identity: "aligned" | "divergent" | "uncomparable";
	readonly aligned: boolean;
}

/** PURE. How a node's live config and a declaration disagree. */
export function diffDeclarations(
	nodeConfig: Record<string, unknown>,
	declaration: NodeDeclaration,
): DeclarationDiff {
	const source = declaration.declarations ?? {};
	const keys = [...new Set([...Object.keys(nodeConfig), ...Object.keys(source)])].sort();
	const verdicts = keys.map((key) => {
		const onNode = Object.hasOwn(nodeConfig, key);
		const inSource = Object.hasOwn(source, key);
		if (onNode && !inSource) return { key, verdict: "node-only" as const };
		if (!onNode && inSource) return { key, verdict: "source-only" as const };
		const same = JSON.stringify(nodeConfig[key]) === JSON.stringify(source[key]);
		return { key, verdict: same ? ("aligned" as const) : ("divergent" as const) };
	});
	// Identity is not compared here — this module never reads the node's key files. `uncomparable`
	// is the honest answer whenever the seal cannot be opened; a build that CAN open it compares in
	// the command layer, where the files are.
	const sealState = readSealState(declaration.seal);
	const identity = sealState.state === "openable" ? ("aligned" as const) : ("uncomparable" as const);
	return {
		keys: verdicts,
		identity,
		aligned: verdicts.every((entry) => entry.verdict === "aligned") && identity === "aligned",
	};
}
