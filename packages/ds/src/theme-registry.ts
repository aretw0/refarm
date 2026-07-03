import type { DsTheme } from "./contract.js";
import { runDsThemeConformance } from "./theme-conformance.js";

/**
 * A registered theme: a surface-neutral map of semantic tokens (the
 * `ds-tokens:v1` contract) to values. A theme is declared ONCE here and each
 * renderer projects it to its surface — web maps the tokens to CSS custom
 * properties (tokens.css), a TUI maps them to terminal colors, and so on. The
 * registry owns nothing surface-specific; it only guarantees a theme is
 * complete (every REQUIRED_TOKENS is set) before any renderer consumes it.
 */
export interface RegisteredTheme {
	id: string;
	theme: DsTheme;
	source: "built-in" | "plugin";
}

export interface ThemeRegistrationResult {
	ok: boolean;
	id: string;
	missing: string[];
}

/**
 * A registry of conformant, surface-neutral themes. `register` fails a theme
 * that does not satisfy the token contract, so a renderer never receives an
 * incomplete theme; `has`/`get` give the host a name guard so a requested theme
 * that was never registered is caught instead of silently rendering nothing
 * (today an unknown web theme name yields a 404 CSS <link>).
 */
export class ThemeRegistry {
	#byId = new Map<string, RegisteredTheme>();

	/**
	 * Register a theme after checking it satisfies the ds-tokens:v1 contract.
	 * Returns the conformance outcome; on failure nothing is registered and the
	 * missing tokens are reported. A duplicate id is rejected.
	 */
	register(
		id: string,
		theme: Partial<DsTheme>,
		source: RegisteredTheme["source"] = "plugin",
	): ThemeRegistrationResult {
		const trimmedId = id.trim();
		if (trimmedId.length === 0) {
			return { ok: false, id, missing: ["<id>"] };
		}
		if (this.#byId.has(trimmedId)) {
			return { ok: false, id: trimmedId, missing: ["<duplicate-id>"] };
		}
		const conformance = runDsThemeConformance(theme);
		if (!conformance.pass) {
			return { ok: false, id: trimmedId, missing: [...conformance.missing] };
		}
		this.#byId.set(trimmedId, {
			id: trimmedId,
			theme: theme as DsTheme,
			source,
		});
		return { ok: true, id: trimmedId, missing: [] };
	}

	has(id: string): boolean {
		return this.#byId.has(id.trim());
	}

	get(id: string): RegisteredTheme | undefined {
		return this.#byId.get(id.trim());
	}

	list(): RegisteredTheme[] {
		return [...this.#byId.values()];
	}

	ids(): string[] {
		return [...this.#byId.keys()];
	}
}

/** A theme-pack asset payload a plugin ships (a token JSON matching DsTheme). */
export interface ThemePackAsset {
	id: string;
	theme: Partial<DsTheme>;
}

/**
 * Register plugin-provided theme packs into a registry, each gated by token
 * conformance. `packs` are the already-loaded asset payloads (the host reads
 * the `{layer:"asset", kind:"theme-pack"}` surfaces and loads their JSON assets;
 * this stays manifest-agnostic so ds carries no plugin-system dependency).
 * Returns one result per pack so the caller can surface which themes were
 * rejected and why.
 */
export function registerThemePacks(
	registry: ThemeRegistry,
	packs: readonly ThemePackAsset[],
): ThemeRegistrationResult[] {
	return packs.map((pack) => registry.register(pack.id, pack.theme, "plugin"));
}
