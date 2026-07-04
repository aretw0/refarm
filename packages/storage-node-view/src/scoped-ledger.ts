import type { NormalisedNode } from "@refarm.dev/node-contract-v1";
import {
	type LedgerScope,
	type ScopeResolutionOptions,
	createNodeFsStorageProvider,
	orderedScopeStorePaths,
	resolveScopedStorePath,
} from "@refarm.dev/storage-fs";

import { NodeView } from "./node-view.js";

/**
 * The one host bootstrap for durable node-ledgers. Compose the three primitives
 * that already exist — scope resolution (`user < workspace`), the atomic fs
 * StorageProvider, and the NodeView record⇄node bridge — into a single call so
 * NO caller has to know WHERE bytes land or wire the provider by hand.
 *
 * "Anyone who wants persistence, anywhere" asks for a named ledger at an intended
 * scope; this resolves the path, opens the fs store, and hands back a node face.
 * The fs provider stays scope-agnostic (host injects the path); scope precedence
 * lives once in `storage-fs/scope.ts`; this factory is the seam that binds them.
 */

/** File name for a ledger's single JSON store, under `<scope>/.refarm/<name>/`. */
const LEDGER_STORE_FILE = "ledger.json";

export interface OpenScopedLedgerOptions extends ScopeResolutionOptions {
	/**
	 * Store file name within the ledger directory. Defaults to `ledger.json`, so a
	 * ledger named "scheduler" lands at `<scope>/.refarm/scheduler/ledger.json`.
	 */
	storeFile?: string;
	/** Injected clock, forwarded to the NodeView for deterministic tests. */
	now?: () => string;
}

/** Absolute store path a scoped ledger resolves to (no I/O; for logging/tests). */
export function scopedLedgerPath(
	name: string,
	scope: LedgerScope,
	options: OpenScopedLedgerOptions = {},
): string {
	const storeFile = options.storeFile ?? LEDGER_STORE_FILE;
	return resolveScopedStorePath(scope, `${name}/${storeFile}`, options);
}

/**
 * Open a durable node-ledger for `name` at the intended `scope`. Returns a
 * NodeView over an fs-backed store at `<scope>/.refarm/<name>/ledger.json`. The
 * store file and its directory are created lazily on first write (atomic
 * temp+rename, owner-only modes — inherited from the fs provider), so opening is
 * cheap and never touches disk on its own.
 */
export function openScopedLedger(
	name: string,
	scope: LedgerScope,
	options: OpenScopedLedgerOptions = {},
): NodeView {
	const path = scopedLedgerPath(name, scope, options);
	return new NodeView(createNodeFsStorageProvider(path), { now: options.now });
}

/** A ledger opened at a given scope, tagged with that scope for folding. */
export interface ScopedLedgerLayer {
	scope: LedgerScope;
	path: string;
	ledger: NodeView;
}

/**
 * Open the SAME named ledger at every scope, in apply order (lowest precedence
 * first: `user`, then `workspace`). A composer folds these left-to-right so a
 * workspace layer overrides a user layer for the same node id — the override
 * doctrine (a workspace layer wins; both layer over the base, never editing it).
 * Reading the effective value of a node id means asking each layer in reverse.
 */
export function openScopedLedgerLayers(
	name: string,
	options: OpenScopedLedgerOptions = {},
): ScopedLedgerLayer[] {
	const storeFile = options.storeFile ?? LEDGER_STORE_FILE;
	return orderedScopeStorePaths(`${name}/${storeFile}`, options).map(
		({ scope, path }) => ({
			scope,
			path,
			ledger: new NodeView(createNodeFsStorageProvider(path), {
				now: options.now,
			}),
		}),
	);
}

/**
 * Resolve the effective node for `id` across scope layers: the highest-precedence
 * layer (workspace over user) that has the node wins; null if no layer has it.
 * This is the read side of the override doctrine, kept here so callers fold
 * layers the same way everywhere instead of re-implementing precedence.
 */
export async function readLayeredNode(
	layers: ScopedLedgerLayer[],
	id: string,
): Promise<NormalisedNode | null> {
	for (let index = layers.length - 1; index >= 0; index -= 1) {
		const node = await layers[index]!.ledger.getNode(id);
		if (node) return node;
	}
	return null;
}
