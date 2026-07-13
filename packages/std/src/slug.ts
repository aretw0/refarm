/**
 * The canonical SLUGIFY — one accent-aware implementation, so a title slugs the same everywhere.
 *
 * Before this, ~6 copies existed across the substrate (skill-contract, vault-contract,
 * content-projection, capabilities-v1, operator-state, …) and they DIVERGED: only some stripped
 * diacritics, so `Título com Acentuação` slugged to `t-tulo…` in one place and `titulo…` in
 * another — a real pt-BR consistency bug. This is the accent-aware variant (NFD + combining-mark
 * strip), promoted as the shared one.
 */

const COMBINING_MARKS = /[\u0300-\u036f]/g;

export interface SlugifyOptions {
	/** The fallback when the input slugs to empty (default "unnamed"). */
	fallback?: string;
	/** Max length of the slug (default: unbounded). */
	maxLength?: number;
}

/**
 * Slugify a string to a lowercase, ascii-ish, dash-separated token: strip diacritics (so accented
 * letters fold to their base — `ção` → `cao`), lowercase, collapse any run of non-alphanumerics to
 * a single dash, and trim leading/trailing dashes. Empty result → the fallback. PURE + deterministic.
 */
export function slugify(value: string, options: SlugifyOptions = {}): string {
	let slug = value
		.normalize("NFD")
		.replace(COMBINING_MARKS, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (options.maxLength !== undefined && slug.length > options.maxLength) {
		slug = slug.slice(0, options.maxLength).replace(/-+$/g, "");
	}
	return slug || options.fallback || "unnamed";
}
