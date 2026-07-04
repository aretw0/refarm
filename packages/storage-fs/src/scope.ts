import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Ledger scope resolution — turns an INTENT ("org" / "workspace" / "user") plus a
 * relative store path into an absolute store path, without the caller hard-coding
 * home-dir logic.
 *
 * WHY: the config/install-override doctrine needs scopes with a defined
 * precedence. There are three, most-specific first: **user** (personal override,
 * the default) > **workspace** (this project) > **org** (a shared base an
 * organization distributes, inherited). `orderedScopes()` returns paths in APPLY
 * order (LOWEST precedence first: `[org, workspace, user]`) so a composer folds
 * them left-to-right and the user layer wins on conflict, while org is the base
 * everything layers over.
 *
 * `user` and `workspace` are LOCAL — the filesystem knows where they live
 * (`~/.refarm`, `./.refarm`). `org` is NOT local: an organization has no home on
 * this filesystem — it is shared/remote by nature and is the FIRST tier a
 * content-addressed resolver serves (fs today via an injected `orgRoot`; a
 * p2p/OPFS backend tomorrow). So `org`'s root is INJECTED, never assumed — this
 * scope is the bridge from the local fs world to distributed resolution.
 */

export type LedgerScope = "org" | "workspace" | "user";

export interface ScopeResolutionOptions {
	/** Workspace root (defaults to process.cwd()). Injected for testability. */
	workspaceRoot?: string;
	/** User home (defaults to os.homedir()). Injected for testability. */
	userHome?: string;
	/**
	 * Org root — the shared/remote base. REQUIRED to resolve the `org` scope; it
	 * has no filesystem default because an org has no local home. A host wires it
	 * from config today, or from a content-addressed resolver later. `org` scopes
	 * are silently skipped by `orderedScopeStorePaths` when it is absent.
	 */
	orgRoot?: string;
	/** Ledger root directory name under each scope. Defaults to ".refarm". */
	ledgerDir?: string;
}

const DEFAULT_LEDGER_DIR = ".refarm";

/**
 * The org root has no fs default; callers that resolve `org` directly must supply
 * `orgRoot`. This sentinel makes an accidental unset-org resolution fail loudly
 * rather than silently landing under the cwd.
 */
class MissingOrgRootError extends Error {
	constructor() {
		super(
			"The `org` ledger scope has no filesystem default — pass `orgRoot` " +
				"(the shared/resolved org base) to resolve it.",
		);
		this.name = "MissingOrgRootError";
	}
}

function scopeRoot(scope: LedgerScope, options: ScopeResolutionOptions): string {
	const ledgerDir = options.ledgerDir ?? DEFAULT_LEDGER_DIR;
	if (scope === "user") {
		return join(options.userHome ?? homedir(), ledgerDir);
	}
	if (scope === "org") {
		if (options.orgRoot === undefined) throw new MissingOrgRootError();
		return join(resolve(options.orgRoot), ledgerDir);
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
 * Return the store paths for every ACTIVE scope in APPLY order (lowest precedence
 * first): `["<org>/...", "<workspace>/...", "<user>/..."]`. A composer folds these
 * left-to-right, so `user` wins on conflict, `workspace` overrides `org`, and
 * `org` is the shared base everything layers over. The `org` layer is included
 * ONLY when `orgRoot` is supplied — an org base is opt-in (a solo/local run has
 * no org), so its absence simply drops that layer rather than erroring.
 *
 * This is the single place the org < workspace < user precedence is expressed.
 */
export function orderedScopeStorePaths(
	relativeStorePath: string,
	options: ScopeResolutionOptions = {},
): Array<{ scope: LedgerScope; path: string }> {
	const order: LedgerScope[] = ["org", "workspace", "user"];
	return order
		.filter((scope) => scope !== "org" || options.orgRoot !== undefined)
		.map((scope) => ({
			scope,
			path: resolveScopedStorePath(scope, relativeStorePath, options),
		}));
}
