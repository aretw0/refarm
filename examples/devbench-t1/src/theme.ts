/**
 * The devbench THEME overlay — an OPTIONAL brand/context skin, applied only when the operator asks
 * (DGK_THEME). The substrate stays neutral (a generic extension bench); this app supplies the theme.
 * The default is the plain white-label bench; `serpro` frames it for the WASM-Plugins innovation
 * context (T1 may cite the theme more than the other tracks). No theme name is hardcoded into any
 * generic package — it lives here, behind an env var, exactly like the command rebrand.
 */

export interface DevbenchTheme {
	/** The bench description shown on the CLI. */
	description: string;
	/** A one-line framing of what the bench demonstrates, for a face header. */
	tagline: string;
}

const THEMES: Record<string, DevbenchTheme> = {
	neutral: {
		description: "Digital Gardening Kit - extension bench",
		tagline: "Uma bancada para desenvolver e governar extensões em sandbox.",
	},
	serpro: {
		// The WASM-Plugins innovation framing — sovereign, governed extensibility for modernizing
		// critical systems. Kept generic (no institution named beyond the theme).
		description: "Bancada de Extensibilidade Segura (WASM) — modernização governada",
		tagline:
			"Extensibilidade como política de governança e soberania: núcleo estável + plugins em sandbox, com manifesto, integridade, maturidade e observabilidade.",
	},
};

/** Resolve the theme from the environment (DGK_THEME), defaulting to the neutral bench. */
export function resolveDevbenchTheme(env: NodeJS.ProcessEnv = process.env): DevbenchTheme {
	const name = (env.DGK_THEME ?? "neutral").trim().toLowerCase();
	return THEMES[name] ?? THEMES.neutral!;
}

/** The theme names the overlay knows (for a `--help`/discovery hint). */
export const DEVBENCH_THEMES = Object.keys(THEMES);
