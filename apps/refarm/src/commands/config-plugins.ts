import { refarmCommand } from "@refarm.dev/cli/command-handoff";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/cli/json-output";
import type { LedgerScope } from "@refarm.dev/storage-node-view";
import chalk from "chalk";
import { Command } from "commander";
import {
	compositionScopePath,
	resolveComposition,
	type ResolvedPackageSource,
} from "../utils/composition-resolver.js";
import {
	getSource,
	SURFACE_KEYS,
	type PackageSourceObject,
	type SurfaceKey,
} from "../utils/composition.js";
import {
	type ConfigDeps,
	hasJsonOption,
	type JsonOptionCarrier,
	readConfig,
	writeConfig,
} from "./config-shared.js";

// ── Composition layer (`config plugins`) ───────────────────────────────────
// The plugins[] LIST is a different concern from the scalar config keys: it is
// the COMPOSITION declaration (which packages a scope activates + pi-style
// suppression), authored via this subgroup rather than `config set`. It lives in
// the SAME config.json but never enters the ConfigKey grammar.

const CONFIG_PLUGINS_LIST_JSON_COMMAND = refarmCommand([
	"config",
	"plugins",
	"list",
	"--json",
]);

// SURFACE_KEYS is imported from composition.ts (the single source, guarded exhaustive
// against the SurfaceKey union) — no longer re-listed here where it could drift.

/** Parse a --scope value for a composition write; null when unrecognized. */
function parseCompositionScope(
	value: string | undefined,
): LedgerScope | null {
	if (value === undefined) return "user";
	return value === "org" || value === "workspace" || value === "user"
		? value
		: null;
}

/** Project a resolved composition entry for output, expanding its suppression
 * into a per-surface effective view when `effective` is requested. */
function projectCompositionEntry(
	resolved: ResolvedPackageSource,
	effective: boolean,
) {
	const { entry, source, scope } = resolved;
	const base = { source, scope, form: typeof entry === "string" ? "bare" : "object" };
	if (!effective || typeof entry === "string") return base;
	// For an object entry, surface the declared patterns and whether the surface
	// is fully active, fully suppressed, or filtered — the "what's actually on".
	const surfaces: Record<string, { patterns: string[]; allActive: boolean }> = {};
	for (const key of SURFACE_KEYS) {
		const patterns = entry[key];
		if (patterns === undefined) continue; // absent = all active, nothing to show
		surfaces[key] = {
			patterns: [...patterns],
			// All-active only when the surface key is absent; a present array filters.
			allActive: false,
		};
	}
	return { ...base, surfaces };
}

export function buildCompositionListEnvelope(
	deps: ConfigDeps,
	opts: {
		scope?: string;
		effective?: boolean;
		env?: Record<string, string | undefined>;
	},
) {
	const scope = parseCompositionScope(opts.scope);
	if (opts.scope !== undefined && !scope) {
		return buildJsonErrorEnvelope({
			command: "config",
			operation: "plugins.list",
			error: "unknown-scope",
			message: `Unknown scope "${opts.scope}". Use org | workspace | user.`,
			nextAction: "Re-run with --scope org, workspace, or user.",
			nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
		});
	}
	// The resolver folds all active tiers; --scope only filters the VIEW (it does
	// not change what is read, so an org entry inherited into effect still shows).
	const resolution = resolveComposition({
		cwd: deps.cwd(),
		home: deps.home(),
		...(opts.env ? { env: opts.env } : {}),
	});
	const activeScopes = resolution.consulted.map((c) => c.scope);
	// Guard --scope org when the org tier is not active (no REFARM_ORG_HOME).
	if (scope === "org" && !activeScopes.includes("org")) {
		return buildJsonErrorEnvelope({
			command: "config",
			operation: "plugins.list",
			error: "org-scope-unavailable",
			message:
				"The org scope is not active. Set REFARM_ORG_HOME to a shared org base to use --scope org.",
			nextAction:
				"Set REFARM_ORG_HOME to a shared org base, or omit --scope org.",
			nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
		});
	}
	const entries = resolution.plugins
		.filter((p) => (opts.scope === undefined ? true : p.scope === scope))
		.map((p) => projectCompositionEntry(p, opts.effective === true));
	return buildJsonSuccessEnvelope({
		command: "config",
		operation: "plugins.list",
		extra: {
			plugins: entries,
			count: entries.length,
			scopesConsulted: activeScopes,
			effective: opts.effective === true,
		},
	});
}

function printCompositionList(
	deps: ConfigDeps,
	opts: { scope?: string; effective?: boolean },
): void {
	const envelope = buildCompositionListEnvelope(deps, opts) as {
		ok: boolean;
		error?: string;
		message?: string;
		plugins?: { source: string; scope: string; form: string }[];
		count?: number;
	};
	if (!envelope.ok) {
		console.error(chalk.red(`✗  ${envelope.message ?? envelope.error}`));
		return;
	}
	if ((envelope.count ?? 0) === 0) {
		console.log(chalk.dim("No composed packages. Add one with:"));
		console.log("  refarm config plugins add <source>");
		return;
	}
	console.log(chalk.bold(`Composed packages (${envelope.count}):`));
	for (const p of envelope.plugins ?? []) {
		console.log(
			`  ${chalk.cyan(p.source)}  ${chalk.dim(`[${p.scope}]`)}  ${chalk.dim(p.form)}`,
		);
	}
}

/**
 * Add or remove a bare-string composition entry at ONE scope, via read-modify-
 * write on that scope's config.json (reusing the scalar path's readConfig/
 * writeConfig, so scalar siblings are preserved). `add` is idempotent by source
 * (Set-union: re-adding an existing source is a no-op, and NEVER downgrades an
 * existing object entry to a bare string). `remove` DE-DECLARES — it drops the
 * entry from this scope's list; it is NOT a physical uninstall (that is
 * `refarm plugin` / barn). Returns a handoff envelope.
 */
export function buildCompositionMutationEnvelope(
	deps: ConfigDeps,
	op: "add" | "remove",
	source: string,
	opts: {
		scope?: string;
		env?: Record<string, string | undefined>;
	} = {},
) {
	const scope = parseCompositionScope(opts.scope);
	if (opts.scope !== undefined && !scope) {
		return buildJsonErrorEnvelope({
			command: "config",
			operation: `plugins.${op}`,
			error: "unknown-scope",
			message: `Unknown scope "${opts.scope}". Use org | workspace | user.`,
			nextAction: "Re-run with --scope org, workspace, or user.",
			nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
		});
	}
	const trimmed = source.trim();
	if (!trimmed) {
		return buildJsonErrorEnvelope({
			command: "config",
			operation: `plugins.${op}`,
			error: "empty-source",
			message: "A package source must be a non-empty string.",
			nextAction: "Pass a source, e.g. `config plugins add @refarm/agent`.",
			nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
		});
	}
	const filePath = compositionScopePath(scope ?? "user", {
		cwd: deps.cwd(),
		home: deps.home(),
		...(opts.env ? { env: opts.env } : {}),
	});
	if (!filePath) {
		return buildJsonErrorEnvelope({
			command: "config",
			operation: `plugins.${op}`,
			error: "org-scope-unavailable",
			message:
				"The org scope is not active. Set REFARM_ORG_HOME to a shared org base to write there.",
			nextAction:
				"Set REFARM_ORG_HOME to a shared org base, or omit --scope org.",
			nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
		});
	}

	const config = readConfig(filePath);
	const before = config.plugins ?? [];
	const existingIndex = before.findIndex((entry) => getSource(entry) === trimmed);
	let changed = false;
	let plugins = before;
	if (op === "add") {
		if (existingIndex === -1) {
			// Idempotent Set-union: only append when the source is not already
			// present. An existing object entry is left intact (never downgraded).
			plugins = [...before, trimmed];
			changed = true;
		}
	} else {
		if (existingIndex !== -1) {
			plugins = before.filter((entry) => getSource(entry) !== trimmed);
			changed = true;
		}
	}
	if (changed) {
		writeConfig(filePath, { ...config, plugins });
	}

	return buildJsonSuccessEnvelope({
		command: "config",
		operation: `plugins.${op}`,
		extra: {
			source: trimmed,
			scope: scope ?? "user",
			path: filePath,
			changed,
			// The de-declare vs uninstall distinction, surfaced on the contract.
			...(op === "remove"
				? { note: "de-declared from composition (not a physical uninstall)" }
				: {}),
		},
		nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
	});
}

function printCompositionMutation(
	deps: ConfigDeps,
	op: "add" | "remove",
	source: string,
	opts: { scope?: string },
): void {
	const envelope = buildCompositionMutationEnvelope(deps, op, source, opts) as {
		ok: boolean;
		error?: string;
		message?: string;
		source?: string;
		scope?: string;
		path?: string;
		changed?: boolean;
	};
	if (!envelope.ok) {
		console.error(chalk.red(`✗  ${envelope.message ?? envelope.error}`));
		return;
	}
	const verb = op === "add" ? "added" : "removed";
	if (!envelope.changed) {
		const already = op === "add" ? "already present" : "not present";
		console.log(chalk.dim(`•  ${envelope.source} ${already} in [${envelope.scope}] — no change`));
		return;
	}
	console.log(chalk.green(`✓  ${verb} ${envelope.source}  [${envelope.scope}]`));
	console.log(chalk.dim(`   ${envelope.path}`));
	if (op === "remove") {
		console.log(chalk.dim("   de-declared from composition (not a physical uninstall)"));
	}
}

function isSurfaceKey(value: string): value is SurfaceKey {
	return (SURFACE_KEYS as readonly string[]).includes(value);
}

/** Split a surface pattern array into its bare includes and `!`-prefixed excludes. */
function partitionPatterns(patterns: string[]): {
	includes: string[];
	excludes: string[];
} {
	const includes: string[] = [];
	const excludes: string[] = [];
	for (const p of patterns) {
		if (p.startsWith("!")) excludes.push(p.slice(1));
		else includes.push(p);
	}
	return { includes, excludes };
}

/**
 * Add or remove a `!pattern` suppression on ONE surface of ONE entry — the only
 * authoring path for the `!`-grammar, so `!` never leaks into the scalar
 * commands. `suppress` promotes a bare-string entry to object form on first use
 * and Set-union-adds `!<pattern>`; `unsuppress` removes it and DROPS the surface
 * key when it empties (restoring absent = all-active) and collapses an entry back
 * to a bare string when it has no surfaces left. Mixing a bare include with a
 * `!`exclude in one surface flips it to an allowlist — rejected unless
 * `allowModeFlip`, since that silently changes the meaning of the other patterns.
 */
export function buildCompositionSuppressEnvelope(
	deps: ConfigDeps,
	op: "suppress" | "unsuppress",
	source: string,
	surface: string,
	pattern: string,
	opts: {
		scope?: string;
		allowModeFlip?: boolean;
		env?: Record<string, string | undefined>;
	} = {},
) {
	const fail = (error: string, message: string, nextAction: string) =>
		buildJsonErrorEnvelope({
			command: "config",
			operation: `plugins.${op}`,
			error,
			message,
			nextAction,
			nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
		});

	const scope = parseCompositionScope(opts.scope);
	if (opts.scope !== undefined && !scope) {
		return fail(
			"unknown-scope",
			`Unknown scope "${opts.scope}". Use org | workspace | user.`,
			"Re-run with --scope org, workspace, or user.",
		);
	}
	if (!isSurfaceKey(surface)) {
		return fail(
			"unknown-surface",
			`Unknown surface "${surface}". Use ${SURFACE_KEYS.join(" | ")}.`,
			`Pass one of: ${SURFACE_KEYS.join(", ")}.`,
		);
	}
	const cleanPattern = pattern.trim().replace(/^!/, "");
	if (!source.trim() || !cleanPattern) {
		return fail(
			"empty-argument",
			"suppress needs a non-empty source and pattern.",
			"e.g. `config plugins suppress npm:@acme/x skills skills/legacy`.",
		);
	}

	const filePath = compositionScopePath(scope ?? "user", {
		cwd: deps.cwd(),
		home: deps.home(),
		...(opts.env ? { env: opts.env } : {}),
	});
	if (!filePath) {
		return fail(
			"org-scope-unavailable",
			"The org scope is not active. Set REFARM_ORG_HOME to a shared org base to write there.",
			"Set REFARM_ORG_HOME to a shared org base, or omit --scope org.",
		);
	}

	const config = readConfig(filePath);
	const plugins = [...(config.plugins ?? [])];
	const index = plugins.findIndex((e) => getSource(e) === source.trim());
	if (index === -1) {
		return fail(
			"source-not-declared",
			`"${source.trim()}" is not declared in [${scope ?? "user"}]. Add it first.`,
			`Run \`config plugins add ${source.trim()}\` first.`,
		);
	}

	const current = plugins[index]!;
	const obj: PackageSourceObject =
		typeof current === "string" ? { source: current } : { ...current };
	const surfacePatterns = [...(obj[surface] ?? [])];
	const denyToken = `!${cleanPattern}`;
	let changed = false;

	if (op === "suppress") {
		const { includes } = partitionPatterns(surfacePatterns);
		// Adding a `!exclude` to a surface that already has bare includes flips its
		// meaning (an allowlist ignores excludes for non-listed ids). Guard it.
		if (includes.length > 0 && !opts.allowModeFlip) {
			return fail(
				"mode-flip",
				`Surface "${surface}" already uses an allowlist (${includes.join(", ")}); adding an exclude changes its meaning.`,
				"Re-run with --allow-mode-flip to intentionally mix include + exclude.",
			);
		}
		if (!surfacePatterns.includes(denyToken)) {
			surfacePatterns.push(denyToken);
			changed = true;
		}
		obj[surface] = surfacePatterns;
	} else {
		const next = surfacePatterns.filter((p) => p !== denyToken);
		if (next.length !== surfacePatterns.length) changed = true;
		if (next.length === 0) {
			// Empty array would mean suppress-ALL; unsuppressing the last pattern
			// means "all active", which is the ABSENT state, so drop the key.
			delete obj[surface];
		} else {
			obj[surface] = next;
		}
	}

	// Collapse back to a bare string when no surfaces remain (all-active again).
	const hasSurfaces = SURFACE_KEYS.some((k) => obj[k] !== undefined);
	plugins[index] = hasSurfaces ? obj : obj.source;

	if (changed) writeConfig(filePath, { ...config, plugins });

	return buildJsonSuccessEnvelope({
		command: "config",
		operation: `plugins.${op}`,
		extra: {
			source: source.trim(),
			surface,
			pattern: cleanPattern,
			scope: scope ?? "user",
			path: filePath,
			changed,
			entry: plugins[index],
		},
		nextCommand: CONFIG_PLUGINS_LIST_JSON_COMMAND,
	});
}

function printCompositionSuppress(
	deps: ConfigDeps,
	op: "suppress" | "unsuppress",
	source: string,
	surface: string,
	pattern: string,
	opts: { scope?: string; allowModeFlip?: boolean },
): void {
	const envelope = buildCompositionSuppressEnvelope(
		deps,
		op,
		source,
		surface,
		pattern,
		opts,
	) as {
		ok: boolean;
		error?: string;
		message?: string;
		source?: string;
		surface?: string;
		pattern?: string;
		scope?: string;
		changed?: boolean;
	};
	if (!envelope.ok) {
		console.error(chalk.red(`✗  ${envelope.message ?? envelope.error}`));
		return;
	}
	if (!envelope.changed) {
		console.log(chalk.dim(`•  no change (${op} ${envelope.pattern} on ${envelope.surface})`));
		return;
	}
	const verb = op === "suppress" ? "suppressed" : "unsuppressed";
	console.log(
		chalk.green(
			`✓  ${verb} ${envelope.surface}/${envelope.pattern} on ${envelope.source}  [${envelope.scope}]`,
		),
	);
}

/**
 * The `config plugins` subgroup — the COMPOSITION authoring surface. It is under
 * `config` (beside `profile`), NOT under the top-level `plugin` command: `plugin`
 * manages the PHYSICAL runtime plugin lifecycle (barn/npm/WASM install/reload),
 * while this declares which packages a scope ACTIVATES. Two different meanings of
 * "plugin"; keeping composition under `config` avoids the semantic collision.
 */
export function createConfigPluginsCommand(deps: ConfigDeps): Command {
	return new Command("plugins")
		.description("Inspect the composed packages a scope activates")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm config plugins list
  $ refarm config plugins list --json
  $ refarm config plugins list --effective
  $ refarm config plugins list --scope workspace

Notes:
  Composition (which packages are activated + surface suppression) is distinct
  from \`refarm plugin\` (which physically installs/reloads runtime plugins).
  Entries fold org < workspace < user; the user copy of a source wins.
`,
		)
		.addCommand(
			new Command("list")
				.description("List the effective composed packages, folded across scopes")
				.option("--scope <scope>", "Filter the view to org | workspace | user")
				.option(
					"--effective",
					"Expand each entry's surface suppression (what is actually on)",
				)
				.option("--json", "Output machine-readable composition list")
				.action(
					(
						opts: {
							scope?: string;
							effective?: boolean;
						} & JsonOptionCarrier,
						command: JsonOptionCarrier,
					) => {
						if (hasJsonOption(opts, command)) {
							printJson(buildCompositionListEnvelope(deps, opts));
							return;
						}
						printCompositionList(deps, opts);
					},
				),
		)
		.addCommand(
			new Command("add")
				.description("Activate a package in a scope's composition (idempotent)")
				.argument("<source>", "Package source: npm:@scope/pkg | ../path | id")
				.option("--scope <scope>", "org | workspace | user (default user)")
				.option("--json", "Output machine-readable result")
				.action(
					(
						source: string,
						opts: { scope?: string } & JsonOptionCarrier,
						command: JsonOptionCarrier,
					) => {
						if (hasJsonOption(opts, command)) {
							printJson(
								buildCompositionMutationEnvelope(deps, "add", source, opts),
							);
							return;
						}
						printCompositionMutation(deps, "add", source, opts);
					},
				),
		)
		.addCommand(
			new Command("remove")
				.alias("rm")
				.description(
					"De-declare a package from a scope's composition (NOT a physical uninstall)",
				)
				.argument("<source>", "Package source to drop from this scope")
				.option("--scope <scope>", "org | workspace | user (default user)")
				.option("--json", "Output machine-readable result")
				.action(
					(
						source: string,
						opts: { scope?: string } & JsonOptionCarrier,
						command: JsonOptionCarrier,
					) => {
						if (hasJsonOption(opts, command)) {
							printJson(
								buildCompositionMutationEnvelope(deps, "remove", source, opts),
							);
							return;
						}
						printCompositionMutation(deps, "remove", source, opts);
					},
				),
		)
		.addCommand(
			new Command("suppress")
				.description("Suppress one surface of a package (writes a !pattern)")
				.argument("<source>", "A declared package source")
				.argument("<surface>", `Surface: ${SURFACE_KEYS.join(" | ")}`)
				.argument("<pattern>", "Surface id to suppress, e.g. skills/legacy")
				.option("--scope <scope>", "org | workspace | user (default user)")
				.option(
					"--allow-mode-flip",
					"Permit mixing an allowlist include with a !exclude in one surface",
				)
				.option("--json", "Output machine-readable result")
				.action(
					(
						source: string,
						surface: string,
						pattern: string,
						opts: {
							scope?: string;
							allowModeFlip?: boolean;
						} & JsonOptionCarrier,
						command: JsonOptionCarrier,
					) => {
						if (hasJsonOption(opts, command)) {
							printJson(
								buildCompositionSuppressEnvelope(
									deps,
									"suppress",
									source,
									surface,
									pattern,
									opts,
								),
							);
							return;
						}
						printCompositionSuppress(deps, "suppress", source, surface, pattern, opts);
					},
				),
		)
		.addCommand(
			new Command("unsuppress")
				.description("Remove a surface suppression (drops the !pattern)")
				.argument("<source>", "A declared package source")
				.argument("<surface>", `Surface: ${SURFACE_KEYS.join(" | ")}`)
				.argument("<pattern>", "Surface id to un-suppress")
				.option("--scope <scope>", "org | workspace | user (default user)")
				.option("--json", "Output machine-readable result")
				.action(
					(
						source: string,
						surface: string,
						pattern: string,
						opts: { scope?: string } & JsonOptionCarrier,
						command: JsonOptionCarrier,
					) => {
						if (hasJsonOption(opts, command)) {
							printJson(
								buildCompositionSuppressEnvelope(
									deps,
									"unsuppress",
									source,
									surface,
									pattern,
									opts,
								),
							);
							return;
						}
						printCompositionSuppress(deps, "unsuppress", source, surface, pattern, opts);
					},
				),
		);
}
