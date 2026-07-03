import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Ledger scope resolution — turns an INTENT ("user" or "workspace") plus a
 * relative store path into an absolute filesystem path, without the caller
 * hard-coding home-dir logic.
 *
 * WHY: the config/install-override doctrine needs two scopes with a defined
 * precedence — a workspace override wins over a user override, and both layer
 * over the original manifest (never editing it). This helper makes that
 * precedence a real, testable thing rather than prose: `orderedScopes()`
 * returns paths in APPLY order (lowest precedence first) so a composer can
 * fold them left-to-right and let later layers win.
 */

export type LedgerScope = "user" | "workspace";

export interface ScopeResolutionOptions {
	/** Workspace root (defaults to process.cwd()). Injected for testability. */
	workspaceRoot?: string;
	/** User home (defaults to os.homedir()). Injected for testability. */
	userHome?: string;
	/** Ledger root directory name under each scope. Defaults to ".refarm". */
	ledgerDir?: string;
}

const DEFAULT_LEDGER_DIR = ".refarm";

function scopeRoot(scope: LedgerScope, options: ScopeResolutionOptions): string {
	const ledgerDir = options.ledgerDir ?? DEFAULT_LEDGER_DIR;
	if (scope === "user") {
		return join(options.userHome ?? homedir(), ledgerDir);
	}
	return join(resolve(options.workspaceRoot ?? process.cwd()), ledgerDir);
}

/**
 * Resolve an absolute store path for a single scope.
 *
 * @param relativeStorePath e.g. "barn/ledger.json" or "config/overrides.json".
 *   An absolute path is returned as-is (caller opted out of scope resolution).
 */
export function resolveScopedStorePath(
	scope: LedgerScope,
	relativeStorePath: string,
	options: ScopeResolutionOptions = {},
): string {
	if (isAbsolute(relativeStorePath)) return relativeStorePath;
	return join(scopeRoot(scope, options), relativeStorePath);
}

/**
 * Return the store paths for every scope in APPLY order (lowest precedence
 * first): `["<user>/...", "<workspace>/..."]`. A composer folds these in order
 * so the workspace layer wins on conflict, and both layer over the manifest.
 *
 * This is the single place the user < workspace precedence is expressed.
 */
export function orderedScopeStorePaths(
	relativeStorePath: string,
	options: ScopeResolutionOptions = {},
): Array<{ scope: LedgerScope; path: string }> {
	const order: LedgerScope[] = ["user", "workspace"];
	return order.map((scope) => ({
		scope,
		path: resolveScopedStorePath(scope, relativeStorePath, options),
	}));
}
