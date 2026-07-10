import { orderedScopeStorePaths, type LedgerScope } from "@refarm.dev/storage-node-view";
import fs from "node:fs";
import os from "node:os";

import { getSource, type PackageSource } from "./composition.js";
import { resolveOrgRoot } from "./refarm-home.js";

/**
 * The read side of the COMPOSITION layer: fold each scope's `config.json`
 * `plugins[]` into the effective activation set, applying the org < workspace <
 * user precedence (user wins). This is the composition twin of the skill
 * ledger's org→workspace→user fold — same doctrine, different home: the LIST
 * lives in the human-editable `config.json`, not a node-ledger.
 *
 * WHY a separate resolver (not runtime-config.ts's private 2-tier `configPaths`):
 * the 5 scalars stay 2-tier (home/cwd) — that path is untouched (additive
 * constraint). This resolver is 3-tier and reuses the storage-fs scope authority
 * (`orderedScopeStorePaths`), so the org tier + apply-order live in ONE place.
 *
 * CO-HABITATION GUARANTEE: the user tier MUST land on the exact same file
 * config.ts writes (`os.homedir()/.refarm/config.json`), so scalars and
 * `plugins[]` share one file at every tier. `orderedScopeStorePaths` defaults
 * `userHome` to `os.homedir()` — so we DELIBERATELY do not pass `userHome`
 * (passing the skill-ledger's REFARM_HOME-aware `dirname(resolveRefarmHome())`
 * would split the two into different files under a custom REFARM_HOME). Only the
 * org root is injected (opt-in via REFARM_ORG_HOME).
 */

export interface CompositionResolverDeps {
	/** Workspace root. Defaults to process.cwd(). Injected for tests. */
	cwd?: string;
	/**
	 * User home. Defaults to os.homedir() — the SAME base config.ts's
	 * `configPath({local:false})` uses, so scalars + plugins co-habit one file.
	 * Injected for tests; production leaves it unset.
	 */
	home?: string;
	env?: Record<string, string | undefined>;
}

/** A composition entry tagged with the scope it effectively came from. */
export interface ResolvedPackageSource {
	entry: PackageSource;
	source: string;
	scope: LedgerScope;
}

export interface CompositionResolution {
	/** Effective activation set, one entry per source (highest-precedence copy). */
	plugins: ResolvedPackageSource[];
	/** Per-scope config files consulted, in apply order (lowest precedence first). */
	consulted: { scope: LedgerScope; path: string }[];
}

function readPluginsAt(filePath: string): PackageSource[] {
	if (!fs.existsSync(filePath)) return [];
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
			plugins?: unknown;
		};
		return Array.isArray(parsed.plugins) ? (parsed.plugins as PackageSource[]) : [];
	} catch {
		// A malformed config must not crash composition resolution — an unreadable
		// scope simply contributes nothing (the scalar reader in config.ts still
		// surfaces the parse error on its own path).
		return [];
	}
}

/**
 * Resolve the effective composition across the active scopes. Reads
 * `config.json` at `[org, workspace, user]` (org only when REFARM_ORG_HOME is
 * set), folds left-to-right so user overrides workspace overrides org, replacing
 * a same-`source` entry wholesale (last-wins REPLACE — matching the skill
 * ledger's `effectivePointers.set` overwrite; pi's per-key cross-scope union is a
 * deferred divergence).
 */
export function resolveComposition(deps: CompositionResolverDeps = {}): CompositionResolution {
	const env = deps.env ?? process.env;
	const scopePaths = orderedScopeStorePaths("config.json", {
		workspaceRoot: deps.cwd ?? process.cwd(),
		// userHome intentionally defaulted to os.homedir() (see co-habitation note).
		...(deps.home !== undefined ? { userHome: deps.home } : {}),
		...(resolveOrgRoot(env) ? { orgRoot: resolveOrgRoot(env) } : {}),
	});

	const effective = new Map<string, ResolvedPackageSource>();
	for (const { scope, path } of scopePaths) {
		for (const entry of readPluginsAt(path)) {
			const source = getSource(entry);
			// Higher-precedence scope (later in apply order) replaces the same source.
			effective.set(source, { entry, source, scope });
		}
	}

	return {
		plugins: [...effective.values()],
		consulted: scopePaths.map(({ scope, path }) => ({ scope, path })),
	};
}

/** The user-tier config path this resolver folds — exposed so a test can assert
 * it equals config.ts's `configPath({local:false})` (the co-habitation guarantee). */
export function userScopeConfigPath(home = os.homedir()): string {
	return orderedScopeStorePaths("config.json", { userHome: home }).find((p) => p.scope === "user")!
		.path;
}

/**
 * The `config.json` path for ONE composition scope — the write target for
 * `config plugins add/remove/suppress`. Uses the SAME convention the fold reads
 * (`<scope>/.refarm/config.json`, user root = os.homedir()), so a write lands on
 * exactly the file `list` will read back. `org` requires REFARM_ORG_HOME; the
 * caller must have already gated on its availability (returns null when unset).
 */
export function compositionScopePath(
	scope: LedgerScope,
	deps: { cwd?: string; home?: string; env?: Record<string, string | undefined> } = {},
): string | null {
	const orgRoot = resolveOrgRoot(deps.env ?? process.env);
	if (scope === "org" && !orgRoot) return null;
	const path = orderedScopeStorePaths("config.json", {
		workspaceRoot: deps.cwd ?? process.cwd(),
		...(deps.home !== undefined ? { userHome: deps.home } : {}),
		...(orgRoot ? { orgRoot } : {}),
	}).find((p) => p.scope === scope);
	return path?.path ?? null;
}
